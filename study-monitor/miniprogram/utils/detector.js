/**
 * 分心检测核心模块
 * 使用微信 VKSession 脸部追踪（等价 MediaPipe Face Mesh）
 * 纯本地检测，不上传图像。检测：转头/低头/眨眼/瞌睡/打哈欠
 * 采集姿势时序数据（yaw/pitch/roll/eye/mouth），用于 AI 分析
 */

class AttentionDetector {
  constructor(options = {}) {
    this.onStatusChange = options.onStatusChange || (() => {})
    this.onDistraction = options.onDistraction || (() => {})

    this.isRunning = false
    this.currentStatus = 'focus'
    this.distractionStartTime = null

    // 检测阈值
    const app = getApp()
    this.thresholds = app.globalData.settings.distractionThreshold

    // 统计
    this.stats = {
      focusTime: 0,
      distractionCount: 0,
      distractions: []
    }

    // 姿势时序数据（纯数据，不含图像）
    this.postureTimeline = []
    this.postureSampleInterval = 2000
    this.postureSampleTimer = null

    // VKSession 脸部追踪（优先）
    this.vkSession = null
    // FaceDetectContext 回退（旧设备）
    this.faceDetectCtx = null

    // 最近一次人脸数据（用于采样）
    this.lastFaceData = null

    // 状态追踪
    this.statusStartTime = Date.now()
    this.lastFaceTime = Date.now()

    // 定时器
    this.statusCheckTimer = null
  }

  /**
   * 开始检测（纯本地）
   */
  start() {
    this.isRunning = true
    this.statusStartTime = Date.now()
    // 初始缓冲10秒，等检测API拿到第一帧
    this.lastFaceTime = Date.now() + 10000
    this.lastFaceData = null
    this.postureTimeline = []

    // 读取真实阈值
    const app = getApp()
    this.thresholds = {
      yaw: app.globalData.settings.distractionThreshold.yaw,
      pitch: app.globalData.settings.distractionThreshold.pitch,
      faceLostTimeout: app.globalData.settings.distractionThreshold.faceLostTimeout,
      eyeCloseTimeout: app.globalData.settings.distractionThreshold.eyeCloseTimeout
    }
    console.log('检测器阈值:', JSON.stringify(this.thresholds))

    // 🔥 优先 FaceDetectContext（兼容性最好，内部自带摄像头）
    this._initFaceDetect()

    // 🔥 FaceDetectContext 失败再试 VKSession
    if (!this.faceDetectCtx && typeof wx.createVKSession === 'function') {
      this._initVKFaceTracking()
    }

    this._startPostureSampling()
    this._startStatusCheck()
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

    if (this.faceDetectCtx) {
      try { this.faceDetectCtx.stop() } catch (e) {}
      this.faceDetectCtx = null
    }

    if (this.statusCheckTimer) {
      clearInterval(this.statusCheckTimer)
      this.statusCheckTimer = null
    }

    if (this.postureSampleTimer) {
      clearInterval(this.postureSampleTimer)
      this.postureSampleTimer = null
    }

    return this.getStats()
  }

  /**
   * 🔥 VKSession 脸部追踪（优先方案）
   * 支持：yaw/pitch/roll + 眨眼检测 + 张嘴检测
   */
  _initVKFaceTracking() {
    try {
      this.vkSession = wx.createVKSession({
        track: {
          face: { mode: 2 }  // mode 2 = 含眼部+嘴部特征
        }
      })

      this.vkSession.on('update', (res) => {
        if (!this.isRunning) return

        // 首次收到数据时打印详情
        if (!this._vkFirstDataReceived) {
          this._vkFirstDataReceived = true
          console.log('🎉 VKSession 首次数据:', JSON.stringify(res).substring(0, 300))
        }

        if (res.face && res.face.faces && res.face.faces.length > 0) {
          const face = res.face.faces[0]
          this.lastFaceTime = Date.now()
          this.lastFaceData = face

          // 取消回退计时器
          if (this._vkFallbackTimer) {
            clearTimeout(this._vkFallbackTimer)
            this._vkFallbackTimer = null
          }

          this._processVKFaceData(face)
        } else {
          this._handleNoFace()
        }
      })

      this.vkSession.start({
        success: () => {
          console.log('✅ VKSession 脸部追踪已启动（转头/低头/眨眼/瞌睡/哈欠）')
          wx.showToast({ title: '脸部检测已就绪', icon: 'success', duration: 1500 })

          // 🔥 5秒内没收到人脸数据 → 标记VK无效
          const checkTimer = setTimeout(() => {
            if (this.isRunning && this.vkSession && Date.now() - this.lastFaceTime > 8000) {
              console.warn('VKSession 5秒内无数据')
              try { this.vkSession.destroy() } catch (e) {}
              this.vkSession = null
            }
          }, 5000)
          // 如果收到数据就取消回退
          this._vkFallbackTimer = checkTimer
        },
        fail: (err) => {
          console.warn('VKSession 启动失败:', JSON.stringify(err))
          this.vkSession = null
        }
      })
    } catch (e) {
      console.warn('VKSession 不可用，回退 FaceDetectContext:', e.message)
      this.vkSession = null
    }
  }

  /**
   * FaceDetectContext 主检测方案（兼容性最好）
   * 内部自带摄像头访问，不需要 WXML 中的 <camera> 组件
   */
  _initFaceDetect() {
    if (typeof wx.createFaceDetectContext !== 'function') {
      console.warn('FaceDetectContext 不可用（基础库 < 2.28.0）')
      return
    }

    try {
      this.faceDetectCtx = wx.createFaceDetectContext()
      console.log('✅ FaceDetectContext 创建成功')

      this.faceDetectCtx.onFaceDetect((res) => {
        if (!this.isRunning) return

        // 首次数据
        if (!this._fdcFirstData && (res.faceInfoList?.length > 0)) {
          this._fdcFirstData = true
          console.log('🎉 FaceDetectContext 首次人脸数据:', JSON.stringify(res).substring(0, 200))
        }

        if (res.faceInfoList && res.faceInfoList.length > 0) {
          const face = res.faceInfoList[0]
          this.lastFaceTime = Date.now()
          this.lastFaceData = face
          this._processFDCFaceData(face)
        } else {
          this._handleNoFace()
        }
      })

      this.faceDetectCtx.start({
        success: () => {
          console.log('✅ FaceDetectContext 检测已启动')
          wx.showToast({ title: '人脸检测已就绪', icon: 'success', duration: 1500 })
        },
        fail: (err) => {
          console.error('FaceDetectContext 启动失败:', JSON.stringify(err))
          this.faceDetectCtx = null
          // 回退 VKSession
          if (typeof wx.createVKSession === 'function') {
            this._initVKFaceTracking()
          }
        }
      })
    } catch (e) {
      console.error('FaceDetectContext 创建失败:', e)
      this.faceDetectCtx = null
    }
  }

  /**
   * 🔥 处理 VKSession 脸部数据（丰富版本）
   * 检测：转头、低头、眨眼、瞌睡、打哈欠
   */
  _processVKFaceData(face) {
    // 提取角度
    const angle = face.angle || {}
    const yaw = angle.yaw || 0
    const pitch = angle.pitch || 0
    const roll = angle.roll || 0

    // 采样姿势数据
    this._samplePostureData(yaw, pitch, roll)

    // 判断状态
    let newStatus = 'focus'
    const absYaw = Math.abs(yaw)

    // 1. 闭眼/瞌睡检测（VKSession face mode 2 提供眼部数据）
    if (face.leftEye && face.rightEye) {
      const leftOpen = face.leftEye.openness !== undefined ? face.leftEye.openness : 1
      const rightOpen = face.rightEye.openness !== undefined ? face.rightEye.openness : 1
      const avgEyeOpen = (leftOpen + rightOpen) / 2

      // 记录眼部数据到最近采样
      const lastSample = this.postureTimeline[this.postureTimeline.length - 1]
      if (lastSample && lastSample.faceStatus === 'detected') {
        lastSample.eyeOpen = Math.round(avgEyeOpen * 100)
      }

      // 双眼闭合判断（openness < 0.3 视为闭眼）
      if (avgEyeOpen < 0.3) {
        newStatus = 'eye_close'
      }
    }

    // 2. 张嘴/打哈欠检测
    if (face.mouth && face.mouth.openness > 0.6 && newStatus === 'focus') {
      // 张嘴超过60%可能是打哈欠
      const lastSample = this.postureTimeline[this.postureTimeline.length - 1]
      if (lastSample && lastSample.faceStatus === 'detected') {
        lastSample.mouthOpen = Math.round(face.mouth.openness * 100)
      }
      // 仅做记录，不改变状态（避免和说话混淆）
      // 如果同时低头+张嘴 → 可能是打哈欠
      if (pitch > this.thresholds.pitch * 0.8) {
        newStatus = 'eye_close'  // 作为疲劳信号
      }
    }

    // 3. 转头检测
    if (newStatus === 'focus' && absYaw > this.thresholds.yaw) {
      newStatus = 'look_away'
    }

    // 4. 低头检测
    if (newStatus === 'focus' && pitch > this.thresholds.pitch) {
      newStatus = 'head_down'
    }

    this._updateStatus(newStatus)
  }

  /**
   * 处理 FaceDetectContext 人脸数据（仅角度检测）
   */
  _processFDCFaceData(face) {
    if (!face.angle) {
      // 有人脸但无角度 → 至少是 focus
      this._samplePostureData(0, 0, 0)
      if (this.currentStatus === 'face_lost') {
        this._updateStatus('focus')
      }
      return
    }

    const { yaw, pitch, roll } = face.angle
    const absYaw = Math.abs(yaw || 0)
    const absPitch = Math.abs(pitch || 0)

    this._samplePostureData(yaw || 0, pitch || 0, roll || 0)

    let newStatus = 'focus'

    if (absYaw > this.thresholds.yaw) {
      newStatus = 'look_away'
    } else if (pitch > this.thresholds.pitch) {
      newStatus = 'head_down'
    }

    this._updateStatus(newStatus)
  }

  /**
   * 处理无人脸
   */
  _handleNoFace() {
    const timeSinceLastFace = (Date.now() - this.lastFaceTime) / 1000
    if (timeSinceLastFace > this.thresholds.faceLostTimeout) {
      this._updateStatus('face_lost')
    }
  }

  /**
   * 更新状态
   */
  _updateStatus(newStatus) {
    if (newStatus === this.currentStatus) return

    const now = Date.now()
    const duration = (now - this.statusStartTime) / 1000

    if (this.currentStatus === 'focus') {
      this.stats.focusTime += duration
    }

    // 从专注变为分心
    if (this.currentStatus === 'focus' && newStatus !== 'focus') {
      this._recordDistraction(newStatus, now)
    }

    this.currentStatus = newStatus
    this.statusStartTime = now

    this.onStatusChange({
      status: newStatus,
      duration: duration,
      stats: { ...this.stats }
    })

    // 瞌睡特别提醒
    if (newStatus === 'eye_close') {
      try {
        const app = getApp()
        if (app.globalData.settings.vibrationEnabled) {
          wx.vibrateShort({ type: 'heavy' })
        }
      } catch (e) {}
    }
  }

  /**
   * 记录分心事件
   */
  _recordDistraction(type, timestamp) {
    this.stats.distractionCount++
    this.stats.distractions.push({
      type: type,
      timestamp: timestamp,
      duration: 0
    })

    this.onDistraction({
      type: type,
      count: this.stats.distractionCount
    })

    try {
      const app = getApp()
      if (app.globalData.settings.vibrationEnabled) {
        wx.vibrateShort({ type: 'medium' })
      }
    } catch (e) {}
  }

  /**
   * 状态检查定时器（延迟启动，给检测器初始化时间）
   */
  _startStatusCheck() {
    // 延迟 3 秒再开始检查，等 VKSession/摄像头拿到第一帧
    setTimeout(() => {
      if (!this.isRunning) return
      this.statusCheckTimer = setInterval(() => {
        if (!this.isRunning) return

        const timeSinceLastFace = (Date.now() - this.lastFaceTime) / 1000

        if (timeSinceLastFace > this.thresholds.faceLostTimeout && this.currentStatus !== 'face_lost') {
          this._updateStatus('face_lost')
        }
      }, 500)
    }, 3000)
  }

  /**
   * 姿势采样定时器
   */
  _startPostureSampling() {
    this.postureSampleTimer = setInterval(() => {
      if (!this.isRunning) return

      const timeSinceLastFace = (Date.now() - this.lastFaceTime) / 1000
      if (timeSinceLastFace > 3) {
        const last = this.postureTimeline[this.postureTimeline.length - 1]
        if (!last || last.faceStatus !== 'lost') {
          this.postureTimeline.push({
            timestamp: Date.now(),
            faceStatus: 'lost',
            yaw: null, pitch: null, roll: null,
            eyeOpen: null, mouthOpen: null
          })
          this._trimTimeline()
        }
      }
    }, this.postureSampleInterval)
  }

  /**
   * 采样姿势数据
   */
  _samplePostureData(yaw, pitch, roll) {
    const now = Date.now()
    const lastSample = this.postureTimeline[this.postureTimeline.length - 1]

    if (lastSample && (now - lastSample.timestamp) < this.postureSampleInterval) {
      // 更新眼部/嘴部数据到当前采样
      this._trimTimeline()
      return
    }

    this.postureTimeline.push({
      timestamp: now,
      faceStatus: 'detected',
      yaw: Math.round(yaw * 100) / 100,
      pitch: Math.round(pitch * 100) / 100,
      roll: Math.round((roll || 0) * 100) / 100,
      eyeOpen: null,     // 由 VKSession 回调填充
      mouthOpen: null     // 由 VKSession 回调填充
    })

    this._trimTimeline()
  }

  _trimTimeline() {
    const maxSamples = 1800
    if (this.postureTimeline.length > maxSamples) {
      this.postureTimeline = this.postureTimeline.slice(-maxSamples)
    }
  }

  /**
   * 获取统计
   */
  getStats() {
    const finalDuration = (Date.now() - this.statusStartTime) / 1000
    const stats = { ...this.stats }

    if (this.currentStatus === 'focus') {
      stats.focusTime += finalDuration
    }

    stats.totalTime = (Date.now() - (this.statusStartTime - stats.focusTime * 1000)) / 1000
    stats.efficiency = stats.totalTime > 0
      ? Math.round((stats.focusTime / stats.totalTime) * 100)
      : 100

    stats.postureSummary = this._analyzePostureTimeline()
    stats.postureTimeline = this.postureTimeline

    return stats
  }

  /**
   * 分析姿势时间线
   */
  _analyzePostureTimeline() {
    const timeline = this.postureTimeline
    if (timeline.length === 0) {
      return {
        totalSamples: 0, faceLostCount: 0, faceLostRatio: 0,
        avgYaw: 0, avgPitch: 0, avgRoll: 0,
        maxYawDeviation: 0, maxPitchDeviation: 0,
        headDownRatio: 0, lookAwayRatio: 0, eyeCloseRatio: 0,
        postureStability: 0
      }
    }

    const detectedSamples = timeline.filter(s => s.faceStatus === 'detected')
    const lostSamples = timeline.filter(s => s.faceStatus === 'lost')

    let avgYaw = 0, avgPitch = 0, avgRoll = 0
    let maxAbsYaw = 0, maxAbsPitch = 0
    let headDownCount = 0, lookAwayCount = 0, eyeCloseCount = 0

    if (detectedSamples.length > 0) {
      detectedSamples.forEach(s => {
        avgYaw += s.yaw || 0
        avgPitch += s.pitch || 0
        avgRoll += s.roll || 0
        if (Math.abs(s.yaw || 0) > maxAbsYaw) maxAbsYaw = Math.abs(s.yaw || 0)
        if (Math.abs(s.pitch || 0) > maxAbsPitch) maxAbsPitch = Math.abs(s.pitch || 0)
        if ((s.pitch || 0) > this.thresholds.pitch) headDownCount++
        if (Math.abs(s.yaw || 0) > this.thresholds.yaw) lookAwayCount++
        if (s.eyeOpen !== null && s.eyeOpen < 30) eyeCloseCount++
      })
      avgYaw = Math.round((avgYaw / detectedSamples.length) * 100) / 100
      avgPitch = Math.round((avgPitch / detectedSamples.length) * 100) / 100
      avgRoll = Math.round((avgRoll / detectedSamples.length) * 100) / 100
    }

    let postureStability = 100
    if (detectedSamples.length > 1) {
      const yawVariance = detectedSamples.reduce((sum, s) => sum + Math.pow((s.yaw || 0) - avgYaw, 2), 0) / detectedSamples.length
      const pitchVariance = detectedSamples.reduce((sum, s) => sum + Math.pow((s.pitch || 0) - avgPitch, 2), 0) / detectedSamples.length
      postureStability = Math.max(0, Math.round(100 - (yawVariance + pitchVariance) * 2))
    }

    return {
      totalSamples: timeline.length,
      detectedSamples: detectedSamples.length,
      faceLostCount: lostSamples.length,
      faceLostRatio: Math.round((lostSamples.length / Math.max(timeline.length, 1)) * 100),
      avgYaw, avgPitch, avgRoll,
      maxYawDeviation: Math.round(maxAbsYaw * 100) / 100,
      maxPitchDeviation: Math.round(maxAbsPitch * 100) / 100,
      headDownRatio: detectedSamples.length > 0 ? Math.round((headDownCount / detectedSamples.length) * 100) : 0,
      lookAwayRatio: detectedSamples.length > 0 ? Math.round((lookAwayCount / detectedSamples.length) * 100) : 0,
      eyeCloseRatio: detectedSamples.length > 0 ? Math.round((eyeCloseCount / detectedSamples.length) * 100) : 0,
      postureStability
    }
  }

  /**
   * 获取当前状态
   */
  getCurrentStatus() {
    return {
      status: this.currentStatus,
      isRunning: this.isRunning,
      stats: this.getStats()
    }
  }

  /**
   * 更新阈值
   */
  updateThresholds(newThresholds) {
    if (newThresholds.yaw !== undefined) this.thresholds.yaw = newThresholds.yaw
    if (newThresholds.pitch !== undefined) this.thresholds.pitch = newThresholds.pitch
    if (newThresholds.faceLostTimeout !== undefined) this.thresholds.faceLostTimeout = newThresholds.faceLostTimeout
    if (newThresholds.eyeCloseTimeout !== undefined) this.thresholds.eyeCloseTimeout = newThresholds.eyeCloseTimeout
    console.log('阈值更新:', this.thresholds)
  }

  getThresholds() {
    return { ...this.thresholds }
  }
}

/**
 * 状态文本映射
 */
function getStatusText(status) {
  const map = {
    focus: '专注中',
    look_away: '视线偏离',
    head_down: '低头',
    face_lost: '离开',
    eye_close: '闭眼/瞌睡'
  }
  return map[status] || status
}

/**
 * 状态颜色映射
 */
function getStatusColor(status) {
  const map = {
    focus: '#27AE60',
    look_away: '#F39C12',
    head_down: '#F39C12',
    face_lost: '#E74C3C',
    eye_close: '#E74C3C'
  }
  return map[status] || '#999999'
}

module.exports = {
  AttentionDetector,
  getStatusText,
  getStatusColor
}
