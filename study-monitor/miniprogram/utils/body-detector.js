/**
 * 身体姿态检测模块
 * 使用微信 VKSession（VisionKit）实时检测身体关键点
 * 纯本地运行，不上传图像。提取肩/肘/髋/头关键点坐标
 *
 * 等价于 MediaPipe Pose 的功能，使用微信原生 API
 */

// 身体关键点索引（VKSession body mode 1）
const KP = {
  NOSE: 0,
  LEFT_EYE: 1, RIGHT_EYE: 2,
  LEFT_EAR: 3, RIGHT_EAR: 4,
  LEFT_SHOULDER: 5, RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7, RIGHT_ELBOW: 8,
  LEFT_WRIST: 9, RIGHT_WRIST: 10,
  LEFT_HIP: 11, RIGHT_HIP: 12,
  LEFT_KNEE: 13, RIGHT_KNEE: 14,
  LEFT_ANKLE: 15, RIGHT_ANKLE: 16
}

class BodyPoseDetector {
  constructor(options = {}) {
    this.onPoseUpdate = options.onPoseUpdate || (() => {})
    this.onPostureAlert = options.onPostureAlert || (() => {})

    this.isRunning = false
    this.vkSession = null

    // 身体姿态时间线（纯数据）
    this.bodyTimeline = []
    this.sampleInterval = 2000  // 每2秒采样
    this.sampleTimer = null

    // 姿态阈值（可通过 Agent 动态调整）
    this.thresholds = {
      shoulderTilt: 0.15,      // 耸肩/高低肩阈值（归一化坐标）
      headForward: 0.12,       // 头部前倾阈值
      spineLean: 0.15,         // 脊柱倾斜阈值
      slouchRatio: 0.08        // 驼背比例阈值
    }

    // 持续报警状态
    this.alertState = {
      shoulderTilt: false,
      headForward: false,
      spineLean: false,
      slouching: false
    }
    this.alertStartTime = {}
  }

  /**
   * 开始身体姿态检测
   */
  start() {
    this.isRunning = true
    this.bodyTimeline = []
    this._initVKSession()
    this._startSampling()
  }

  /**
   * 停止检测
   */
  stop() {
    this.isRunning = false

    if (this.vkSession) {
      try { this.vkSession.destroy() } catch (e) {}
      this.vkSession = null
    }

    if (this.sampleTimer) {
      clearInterval(this.sampleTimer)
      this.sampleTimer = null
    }

    return this.getBodySummary()
  }

  /**
   * 初始化 VKSession（微信 VisionKit）
   */
  _initVKSession() {
    // 检查 API 是否可用（基础库 2.20.0+）
    if (typeof wx.createVKSession !== 'function') {
      console.warn('VKSession 不可用（需要基础库 2.20.0+），身体姿态检测降级')
      return
    }

    try {
      this.vkSession = wx.createVKSession({
        track: {
          body: { mode: 1 }  // 全身关键点检测
        }
      })

      // 监听身体关键点更新
      this.vkSession.on('update', (res) => {
        if (!this.isRunning) return
        this._processBodyData(res)
      })

      // 启动
      this.vkSession.start({
        success: () => {
          console.log('VKSession 身体姿态检测已启动')
        },
        fail: (err) => {
          console.error('VKSession 启动失败:', err)
          this.vkSession = null
        }
      })
    } catch (e) {
      console.error('创建 VKSession 失败:', e)
      this.vkSession = null
    }
  }

  /**
   * 处理身体关键点数据
   * 提取姿态特征，纯数据，不含图像
   */
  _processBodyData(res) {
    // 取可信度最高的一帧
    if (!res.body || !res.body.keypoints) return

    const keypoints = res.body.keypoints
    if (!keypoints || keypoints.length < 17) return

    // 提取关键点（含置信度过滤）
    const getKp = (index) => {
      const k = keypoints[index]
      if (!k || k.confidence < 0.3) return null
      return { x: k.x, y: k.y, z: k.z, confidence: k.confidence }
    }

    const nose = getKp(KP.NOSE)
    const leftShoulder = getKp(KP.LEFT_SHOULDER)
    const rightShoulder = getKp(KP.RIGHT_SHOULDER)
    const leftHip = getKp(KP.LEFT_HIP)
    const rightHip = getKp(KP.RIGHT_HIP)
    const leftElbow = getKp(KP.LEFT_ELBOW)
    const rightElbow = getKp(KP.RIGHT_ELBOW)

    // 至少需要双肩 + 双髋（4个关键点）才能做姿态分析
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return

    // 计算姿态指标
    const metrics = this._calculateMetrics({
      nose, leftShoulder, rightShoulder,
      leftHip, rightHip, leftElbow, rightElbow
    })

    // 检查是否触发报警
    this._checkPostureAlerts(metrics)

    // 回调
    this.onPoseUpdate(metrics)
  }

  /**
   * 计算身体姿态指标（纯数值计算）
   */
  _calculateMetrics(kp) {
    const { nose, leftShoulder, rightShoulder, leftHip, rightHip, leftElbow, rightElbow } = kp

    // 1. 高低肩：左右肩 Y 坐标差异
    const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y)

    // 2. 肩髋对正：肩中点 vs 髋中点的 X 偏移（脊柱侧弯/侧倾）
    const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2
    const hipMidX = (leftHip.x + rightHip.x) / 2
    const spineLean = Math.abs(shoulderMidX - hipMidX)

    // 3. 驼背/含胸：肩中点 Y 与髋中点 Y 的比值
    //    正常坐姿肩在上，髋在下。驼背时肩低于髋或比值接近
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2
    const hipMidY = (leftHip.y + rightHip.y) / 2
    const upperBodyRatio = hipMidY > 0 ? shoulderMidY / hipMidY : 1
    const slouching = upperBodyRatio > 0.85  // 肩髋Y接近=驼背

    // 4. 头部前倾：鼻子 vs 肩中点的距离
    let headForward = 0
    if (nose) {
      headForward = Math.abs(nose.x - shoulderMidX)
    }

    // 5. 身体稳定性（与上次采样对比）
    const lastMetrics = this.bodyTimeline[this.bodyTimeline.length - 1]
    let bodyStability = 100
    if (lastMetrics && lastMetrics.shoulderMidY) {
      const movement = Math.abs(shoulderMidY - lastMetrics.shoulderMidY)
        + Math.abs(shoulderMidX - lastMetrics.shoulderMidX)
      bodyStability = Math.max(0, Math.round(100 - movement * 200))
    }

    // 6. 左右肘位置（判断是否有支撑/趴桌）
    const elbowsDown = leftElbow && rightElbow
      && leftElbow.y > hipMidY && rightElbow.y > hipMidY

    return {
      // 原始关键点（仅用于后续分析，不含图像）
      shoulderMidX: Math.round(shoulderMidX * 1000) / 1000,
      shoulderMidY: Math.round(shoulderMidY * 1000) / 1000,
      hipMidX: Math.round(hipMidX * 1000) / 1000,
      hipMidY: Math.round(hipMidY * 1000) / 1000,
      noseX: nose ? Math.round(nose.x * 1000) / 1000 : null,
      noseY: nose ? Math.round(nose.y * 1000) / 1000 : null,

      // 姿态指标
      shoulderTilt: Math.round(shoulderTilt * 1000) / 1000,
      spineLean: Math.round(spineLean * 1000) / 1000,
      headForward: Math.round(headForward * 1000) / 1000,
      slouching: slouching,
      upperBodyRatio: Math.round(upperBodyRatio * 1000) / 1000,
      elbowsDown: elbowsDown,
      bodyStability: bodyStability,

      // 可信度
      confidence: Math.round(
        (leftShoulder.confidence + rightShoulder.confidence + leftHip.confidence + rightHip.confidence) / 4 * 100
      )
    }
  }

  /**
   * 检查是否触发姿态报警
   */
  _checkPostureAlerts(metrics) {
    const alerts = []
    const now = Date.now()

    // 高低肩持续检测
    if (metrics.shoulderTilt > this.thresholds.shoulderTilt) {
      if (!this.alertStartTime.shoulderTilt) this.alertStartTime.shoulderTilt = now
      if (now - this.alertStartTime.shoulderTilt > 5000) {
        alerts.push({ type: 'shoulder_tilt', severity: 'warning', message: '检测到高低肩' })
      }
    } else {
      this.alertStartTime.shoulderTilt = null
    }

    // 头部前倾持续检测
    if (metrics.headForward > this.thresholds.headForward) {
      if (!this.alertStartTime.headForward) this.alertStartTime.headForward = now
      if (now - this.alertStartTime.headForward > 5000) {
        alerts.push({ type: 'head_forward', severity: 'warning', message: '头部前倾' })
      }
    } else {
      this.alertStartTime.headForward = null
    }

    // 驼背持续检测
    if (metrics.slouching) {
      if (!this.alertStartTime.slouching) this.alertStartTime.slouching = now
      if (now - this.alertStartTime.slouching > 8000) {
        alerts.push({ type: 'slouching', severity: 'alert', message: '检测到驼背/含胸' })
      }
    } else {
      this.alertStartTime.slouching = null
    }

    // 脊柱倾斜
    if (metrics.spineLean > this.thresholds.spineLean) {
      if (!this.alertStartTime.spineLean) this.alertStartTime.spineLean = now
      if (now - this.alertStartTime.spineLean > 5000) {
        alerts.push({ type: 'spine_lean', severity: 'warning', message: '脊柱倾斜' })
      }
    } else {
      this.alertStartTime.spineLean = null
    }

    alerts.forEach(alert => {
      this.onPostureAlert(alert)
    })
  }

  /**
   * 采样定时器
   */
  _startSampling() {
    this.sampleTimer = setInterval(() => {
      if (!this.isRunning) return
      // VKSession 回调会自动提供数据，这里做定期快照
      if (this.bodyTimeline.length > 0) {
        const last = this.bodyTimeline[this.bodyTimeline.length - 1]
        // 如果上次采样超过3秒，记录人脸丢失
        if (Date.now() - last.timestamp > 3000) {
          this.bodyTimeline.push({
            timestamp: Date.now(),
            status: 'no_body',
            metrics: null
          })
          // 限制长度
          if (this.bodyTimeline.length > 1800) {
            this.bodyTimeline = this.bodyTimeline.slice(-1800)
          }
        }
      }
    }, this.sampleInterval)
  }

  /**
   * 记录身体姿态数据到时间线
   * 由 _processBodyData 回调自动调用
   */
  recordSample(metrics) {
    this.bodyTimeline.push({
      timestamp: Date.now(),
      status: 'tracking',
      metrics: metrics
    })

    // 限制长度
    if (this.bodyTimeline.length > 1800) {
      this.bodyTimeline = this.bodyTimeline.slice(-1800)
    }
  }

  /**
   * 获取身体姿态摘要
   */
  getBodySummary() {
    const samples = this.bodyTimeline.filter(s => s.status === 'tracking' && s.metrics)
    const totalSamples = this.bodyTimeline.length

    if (samples.length === 0) {
      return {
        available: false,
        totalSamples: 0,
        message: 'VKSession 不可用或无身体数据'
      }
    }

    let sumShoulderTilt = 0, sumSpineLean = 0, sumHeadForward = 0
    let slouchCount = 0, sumStability = 0, sumConfidence = 0

    samples.forEach(s => {
      const m = s.metrics
      sumShoulderTilt += m.shoulderTilt || 0
      sumSpineLean += m.spineLean || 0
      sumHeadForward += m.headForward || 0
      if (m.slouching) slouchCount++
      sumStability += m.bodyStability || 0
      sumConfidence += m.confidence || 0
    })

    const n = samples.length

    return {
      available: true,
      totalSamples: totalSamples,
      trackingSamples: n,
      avgShoulderTilt: Math.round((sumShoulderTilt / n) * 1000) / 1000,
      avgSpineLean: Math.round((sumSpineLean / n) * 1000) / 1000,
      avgHeadForward: Math.round((sumHeadForward / n) * 1000) / 1000,
      slouchRatio: Math.round((slouchCount / n) * 100),
      avgBodyStability: Math.round(sumStability / n),
      avgConfidence: Math.round(sumConfidence / n),
      postureScore: this._calculatePostureScore({
        shoulderTilt: sumShoulderTilt / n,
        spineLean: sumSpineLean / n,
        headForward: sumHeadForward / n,
        slouchRatio: slouchCount / n
      })
    }
  }

  /**
   * 综合身体姿态评分（0-100）
   */
  _calculatePostureScore(avg) {
    let score = 100
    // 高低肩扣分
    if (avg.shoulderTilt > this.thresholds.shoulderTilt) score -= 20
    // 头部前倾扣分
    if (avg.headForward > this.thresholds.headForward) score -= 20
    // 脊柱倾斜扣分
    if (avg.spineLean > this.thresholds.spineLean) score -= 15
    // 驼背扣分
    score -= Math.round(avg.slouchRatio * 30)
    return Math.max(0, Math.min(100, score))
  }

  /**
   * 更新检测阈值（供 Agent 策略调整）
   */
  updateThresholds(newThresholds) {
    if (newThresholds.shoulderTilt !== undefined) this.thresholds.shoulderTilt = newThresholds.shoulderTilt
    if (newThresholds.headForward !== undefined) this.thresholds.headForward = newThresholds.headForward
    if (newThresholds.spineLean !== undefined) this.thresholds.spineLean = newThresholds.spineLean
    if (newThresholds.slouchRatio !== undefined) this.thresholds.slouchRatio = newThresholds.slouchRatio
    console.log('身体姿态阈值已更新:', this.thresholds)
  }

  /**
   * 获取当前阈值
   */
  getThresholds() {
    return { ...this.thresholds }
  }
}

module.exports = {
  BodyPoseDetector
}
