const { AttentionDetector, getStatusText, getStatusColor } = require('../../utils/detector')
const { BodyPoseDetector } = require('../../utils/body-detector')
const { saveRecord, getPlans, getDailyStats, generateId, getToday } = require('../../utils/storage')
const { generateAdvice } = require('../../utils/advice')
const { initAgent, getAgent } = require('../../utils/agent')

const app = getApp()

Page({
  data: {
    // 学习状态
    isRunning: false,
    hasRecord: false,
    focusDuration: app.globalData.settings.focusDuration,

    // 注意力状态
    attentionStatus: 'focus',
    statusText: '专注中',
    statusColor: '#27AE60',
    distractionCount: 0,
    efficiency: 100,

    // 摄像头
    cameraEnabled: true,
    isSimulator: false,

    // 计划
    currentPlan: null,
    plans: [],
    showPicker: false,

    // 今日统计
    todayDuration: '0分钟',
    todaySessions: 0,
    todayEfficiency: 0,

    // 建议
    advice: null,

    // 诊断
    diagMode: false,
    diagApi: '',
    diagYaw: '-',
    diagPitch: '-',
    diagEye: -1,

    // 内部状态
    startTime: null,
    sessionDistractions: []
  },

  detector: null,       // 脸部检测器
  bodyDetector: null,   // 身体姿态检测器（VKSession）
  cameraCtx: null,
  agent: null,

  onLoad() {
    // 🔥 先加载已保存的设置，确保 focusDuration 等参数正确
    this.loadSettings()

    this.loadPlans()
    this.loadTodayStats()
    this.loadAdvice()

    // 检测是否在模拟器中
    const sysInfo = wx.getSystemInfoSync()
    const isSimulator = sysInfo.platform === 'devtools'
    this.setData({ isSimulator })

    // 检查摄像头权限
    if (!isSimulator) {
      wx.getSetting({
        success: (res) => {
          if (res.authSetting['scope.camera']) {
            console.log('摄像头权限已授权')
            this.setData({ cameraEnabled: true })
          } else {
            console.log('摄像头权限未授权，等待用户操作')
            this.setData({ cameraEnabled: false })
          }
        },
        fail: () => {
          this.setData({ cameraEnabled: false })
        }
      })
    }

    // 初始化 Agent（异步，不阻塞页面加载）
    initAgent().then(agent => {
      this.agent = agent
      console.log('Agent 初始化完成')
    }).catch(err => {
      console.error('Agent 初始化失败:', err)
      this.agent = null
    })
  },

  onShow() {
    // 🔥 每次显示时重新加载设置（用户可能在设置页修改过）
    this.loadSettings()

    this.loadPlans()
    this.loadTodayStats()

    // 检查是否有待处理的计划
    if (app.globalData.pendingPlan) {
      const plan = app.globalData.pendingPlan
      app.globalData.pendingPlan = null
      this.setData({
        currentPlan: plan,
        focusDuration: plan.targetDuration || app.globalData.settings.focusDuration
      })
      this.selectComponent('#timer').setDuration(this.data.focusDuration)
    }
  },

  /**
   * 🔥 从 App.globalData 加载已保存的设置
   * 同步到页面 data 和定时器组件
   */
  loadSettings() {
    const settings = app.globalData.settings

    const newData = {
      focusDuration: settings.focusDuration
    }

    // 如果当前有检测器正在运行，动态更新阈值
    if (this.detector) {
      this.detector.updateThresholds(settings.distractionThreshold)
    }

    this.setData(newData)

    // 🔥 同步到定时器组件
    const timer = this.selectComponent('#timer')
    if (timer && !this.data.isRunning) {
      timer.setData({
        focusMinutes: Math.round(settings.focusDuration / 60),
        breakMinutes: Math.round(settings.breakDuration / 60)
      })
      // 如果还未开始学习，更新定时器时长
      if (!this.data.hasRecord) {
        timer.setDuration(settings.focusDuration)
      }
    }

    console.log('设置已加载:', {
      focusDuration: settings.focusDuration / 60 + '分钟',
      breakDuration: settings.breakDuration / 60 + '分钟',
      yawThreshold: settings.distractionThreshold.yaw + '°',
      pitchThreshold: settings.distractionThreshold.pitch + '°'
    })
  },

  /**
   * 加载学习计划
   */
  loadPlans() {
    const plans = getPlans()
    this.setData({
      plans: plans.map(p => ({
        ...p,
        targetText: this.formatDuration(p.targetDuration)
      }))
    })
  },

  /**
   * 加载今日统计
   */
  loadTodayStats() {
    const stats = getDailyStats(getToday())
    this.setData({
      todayDuration: this.formatDuration(stats.totalDuration),
      todaySessions: stats.sessionCount,
      todayEfficiency: stats.efficiency
    })
  },

  /**
   * 加载建议
   */
  async loadAdvice() {
    const stats = getDailyStats(getToday())

    // 优先使用 Agent 的建议
    if (this.agent) {
      try {
        const agentAdvice = await this.agent.getAdvice(stats, [])
        if (agentAdvice && agentAdvice.advice && agentAdvice.advice.length > 0) {
          this.setData({ advice: agentAdvice.advice[0] })
          return
        }
      } catch (err) {
        console.error('获取 Agent 建议失败，使用本地建议:', err)
      }
    }

    // 回退到本地建议
    const adviceList = generateAdvice(stats, [])
    if (adviceList.length > 0) {
      this.setData({ advice: adviceList[0] })
    }
  },

  /**
   * 开始/暂停学习
   */
  toggleStudy() {
    if (this.data.isRunning) {
      this.pauseStudy()
    } else {
      this.startStudy()
    }
  },

  /**
   * 开始学习
   */
  startStudy() {
    // 直接启动计时器，不等待摄像头
    this.setData({
      isRunning: true,
      hasRecord: true,
      startTime: Date.now(),
      sessionDistractions: [],
      attentionStatus: 'focus',
      statusText: '专注中',
      statusColor: '#27AE60'
    })

    // 启动计时器
    const timer = this.selectComponent('#timer')
    if (timer) {
      timer.start()
    }

    // 初始化检测（VKSession 自带摄像头访问，不需要等待 <camera> 组件）
    if (!this.data.isSimulator) {
      setTimeout(() => {
        this.initCamera()
      }, 1000)
    } else {
      console.log('模拟器模式：摄像头/VKSession 不可用，检测功能需在真机上测试')
    }
  },

  /**
   * 初始化本地检测
   * VKSession 自带摄像头访问，不需要 <camera> 组件
   */
  initCamera() {
    console.log('initCamera 被调用, isSimulator:', this.data.isSimulator)

    try {
      // 初始化检测器（纯本地，不上传图像）
      this.detector = new AttentionDetector({
        onStatusChange: (data) => {
          console.log('状态变化:', data.status, '→', getStatusText(data.status))
          this.setData({
            attentionStatus: data.status,
            statusText: getStatusText(data.status),
            statusColor: getStatusColor(data.status),
            distractionCount: data.stats.distractionCount,
            efficiency: data.stats.efficiency
          })
        },
        onDistraction: (data) => {
          console.log('分心事件:', data.type)
          this.data.sessionDistractions.push({
            type: data.type,
            timestamp: Date.now()
          })

          if (app.globalData.settings.vibrationEnabled) {
            wx.vibrateShort({ type: 'medium' })
          }
        }
      })

      // 应用 Agent 策略
      if (this.agent) {
        try {
          const profile = this.agent.getProfile()
          if (profile && profile.behaviorPatterns) {
            this.applyAgentProfile(profile)
          }
        } catch (e) {
          console.warn('Agent profile error:', e)
        }
      }

      // 启动本地检测
      this.detector.start()
      const mode = this.detector.vkSession ? 'VKSession 脸部追踪' : (this.detector.faceDetectCtx ? 'FaceDetectContext' : '无可用API')
      console.log('脸部检测: ' + mode)

      // 🔥 显示诊断
      this.setData({ diagMode: true, diagApi: mode })

      // 🔥 诊断数据刷新
      this.diagTimer = setInterval(() => {
        if (!this.detector || !this.detector.isRunning) return
        const lastData = this.detector.lastFaceData
        if (lastData) {
          const angle = lastData.angle || {}
          let eyeVal = -1
          if (lastData.leftEye && lastData.rightEye) {
            eyeVal = Math.round((lastData.leftEye.openness + lastData.rightEye.openness) / 2 * 100)
          }
          this.setData({
            diagYaw: (angle.yaw || 0).toFixed(1),
            diagPitch: (angle.pitch || 0).toFixed(1),
            diagEye: eyeVal
          })
        } else if (!this.detector.vkSession && !this.detector.faceDetectCtx) {
          // 检测API都没启动成功
          this.setData({ diagApi: '无可用API（基础库版本低或不支持）' })
        }
      }, 1000)

      // 🔥 身体姿态检测：仅在面部 VKSession 不可用时启动
      //     VKSession 面部和身体共用摄像头，不能同时开两个
      if (!this.detector.vkSession) {
        this.initBodyDetection()
      }
    } catch (e) {
      console.error('检测初始化失败:', e)
    }
  },

  /**
   * 🔥 初始化身体姿态检测（VKSession）
   * 检测全身关键点：肩/肘/髋/头，分析驼背/耸肩/前倾
   */
  initBodyDetection() {
    try {
      this.bodyDetector = new BodyPoseDetector({
        onPoseUpdate: (metrics) => {
          // 记录身体姿态到时间线
          if (this.bodyDetector) {
            this.bodyDetector.recordSample(metrics)
          }
        },
        onPostureAlert: (alert) => {
          console.log('身体姿态报警:', alert.type, alert.message)
          // 可选：震动提醒
          if (app.globalData.settings.vibrationEnabled && alert.severity === 'alert') {
            wx.vibrateShort({ type: 'medium' })
          }
        }
      })

      // 应用 Agent 调整的身体阈值
      if (this.agent) {
        try {
          const profile = this.agent.getProfile()
          if (profile && profile.bodyThresholds) {
            this.bodyDetector.updateThresholds(profile.bodyThresholds)
          }
        } catch (e) {}
      }

      this.bodyDetector.start()
      console.log('身体姿态检测已启动')
    } catch (e) {
      console.warn('身体姿态检测启动失败（VKSession可能不可用）:', e.message)
      this.bodyDetector = null
    }
  },

  /**
   * 应用 Agent 的用户画像到检测器
   */
  applyAgentProfile(profile) {
    if (!this.detector || !profile.behaviorPatterns) return

    const patterns = profile.behaviorPatterns

    // 根据分心频率调整阈值
    if (patterns.distractionFrequency === 'high') {
      // 高频分心用户，放宽阈值避免过多干扰
      this.detector.updateThresholds({
        yaw: 30,
        pitch: 25,
        faceLostTimeout: 5
      })
    } else if (patterns.distractionFrequency === 'low') {
      // 低频分心用户，可以收紧阈值提高精度
      this.detector.updateThresholds({
        yaw: 20,
        pitch: 15,
        faceLostTimeout: 2
      })
    }
  },

  /**
   * 暂停学习
   */
  async pauseStudy() {
    let stats = { focusTime: 0, distractionCount: 0, distractions: [], efficiency: 100 }

    if (this.detector) {
      try {
        stats = this.detector.stop()
      } catch (e) {
        console.warn('Detector stop error:', e)
      }
      this.detector = null
    }

    // 清理诊断定时器
    if (this.diagTimer) {
      clearInterval(this.diagTimer)
      this.diagTimer = null
    }
    this.setData({ diagMode: false })

    // 🔥 停止身体检测并获取摘要
    let bodySummary = null
    if (this.bodyDetector) {
      try {
        bodySummary = this.bodyDetector.stop()
      } catch (e) {
        console.warn('BodyDetector stop error:', e)
      }
      this.bodyDetector = null
    }
    stats.bodySummary = bodySummary

    this.setData({
      isRunning: false
    })

    const timer = this.selectComponent('#timer')
    if (timer) {
      timer.pause()
    }

    // 保存记录并获取 AI 建议（含姿势数据）
    await this.saveSession(stats)
  },

  /**
   * 重置学习
   */
  async resetStudy() {
    if (this.data.isRunning) {
      let stats = { focusTime: 0, distractionCount: 0, distractions: [], efficiency: 100 }
      if (this.detector) {
        stats = this.detector.stop()
        this.detector = null
      }
      if (this.diagTimer) {
        clearInterval(this.diagTimer)
        this.diagTimer = null
      }
      if (this.bodyDetector) {
        stats.bodySummary = this.bodyDetector.stop()
        this.bodyDetector = null
      }
      await this.saveSession(stats)
    }

    this.setData({
      isRunning: false,
      hasRecord: false,
      attentionStatus: 'focus',
      statusText: '专注中',
      statusColor: '#27AE60',
      distractionCount: 0,
      efficiency: 100,
      startTime: null,
      sessionDistractions: []
    })

    this.selectComponent('#timer').reset()
    this.loadTodayStats()
    this.loadAdvice()
  },

  /**
   * 保存学习记录（含姿势数据，不含图像）
   */
  async saveSession(stats) {
    const record = {
      id: generateId(),
      date: getToday(),
      planId: this.data.currentPlan ? this.data.currentPlan.id : null,
      startTime: this.data.startTime,
      endTime: Date.now(),
      duration: Math.round((Date.now() - this.data.startTime) / 1000),
      focusDuration: Math.round(stats.focusTime),
      distractions: this.data.sessionDistractions,
      efficiency: stats.efficiency,
      // 🔥 姿势数据（纯数值，无图像）：脸部 + 身体
      postureTimeline: stats.postureTimeline || [],
      postureSummary: stats.postureSummary || null,
      bodySummary: stats.bodySummary || null
    }

    saveRecord(record)

    // 更新计划进度
    if (this.data.currentPlan) {
      this.updatePlanProgress(record.duration)
    }

    // 🔥 调用 Agent 分析（DeepSeek V4）
    if (this.agent) {
      try {
        const analysis = await this.agent.analyze(record)
        if (analysis) {
          console.log('Agent 分析完成:', analysis)

          // 显示 Agent 的建议
          if (analysis.advice && analysis.advice.length > 0) {
            this.setData({
              advice: {
                title: analysis.advice[0].title,
                content: analysis.advice[0].content,
                icon: analysis.advice[0].icon
              }
            })
          }

          // 🔥 显示学习方法推荐
          if (analysis.studyMethods && analysis.studyMethods.length > 0) {
            const methodNames = analysis.studyMethods.map(m => m.name).join('、')
            wx.showModal({
              title: '🎯 推荐学习方法',
              content: `根据你的学习数据，推荐以下方法：\n\n${analysis.studyMethods.map((m, i) =>
                `${i + 1}. ${m.name}\n   ${m.reason || ''}\n   做法：${m.howTo || ''}`
              ).join('\n\n')}`,
              showCancel: false
            })
          }

          // 应用策略调整
          if (analysis.strategyAdjustments) {
            this.agent.applyStrategy(analysis.strategyAdjustments)
          }

          // 显示洞察
          if (analysis.insights && analysis.insights.length > 0) {
            wx.showToast({
              title: analysis.insights[0],
              icon: 'none',
              duration: 3000
            })
          }
        }
      } catch (err) {
        console.error('Agent 分析失败:', err)
      }
    }
  },

  /**
   * 更新计划进度
   */
  updatePlanProgress(duration) {
    const plans = getPlans()
    const plan = plans.find(p => p.id === this.data.currentPlan.id)
    if (plan) {
      plan.completedDuration = (plan.completedDuration || 0) + duration
      if (plan.completedDuration >= plan.targetDuration) {
        plan.status = 'completed'
      }
      const { savePlan } = require('../../utils/storage')
      savePlan(plan)
      this.loadPlans()
    }
  },

  /**
   * 计时器tick
   */
  onTimerTick(e) {
    // 可以在这里更新UI
  },

  /**
   * 计时器完成
   */
  onTimerComplete() {
    wx.showToast({
      title: '专注完成！休息一下',
      icon: 'success'
    })

    // 自动切换到休息
    if (this.data.isRunning) {
      this.pauseStudy()
    }
  },

  /**
   * 摄像头就绪
   */
  onCameraReady() {
    console.log('Camera ready')
    this.setData({ cameraEnabled: true })
  },

  /**
   * 摄像头错误
   */
  onCameraError(e) {
    console.warn('Camera error:', e.detail?.errMsg || '摄像头不可用')
    this.setData({ cameraEnabled: false })
  },

  /**
   * 请求摄像头授权
   */
  requestCameraAuth() {
    wx.authorize({
      scope: 'scope.camera',
      success: () => {
        console.log('摄像头权限已获取')
        this.setData({ cameraEnabled: true })
      },
      fail: () => {
        wx.showModal({
          title: '需要摄像头权限',
          content: '请在设置中允许摄像头权限，以便检测学习状态',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting()
            }
          }
        })
      }
    })
  },

  /**
   * 显示计划选择器
   */
  showPlanPicker() {
    if (this.data.isRunning) {
      wx.showToast({ title: '学习中无法切换计划', icon: 'none' })
      return
    }
    this.setData({ showPicker: true })
  },

  /**
   * 隐藏计划选择器
   */
  hidePlanPicker() {
    this.setData({ showPicker: false })
  },

  /**
   * 选择计划
   */
  selectPlan(e) {
    const plan = e.currentTarget.dataset.plan
    this.setData({
      currentPlan: plan,
      focusDuration: plan.targetDuration || app.globalData.settings.focusDuration,
      showPicker: false
    })
    this.selectComponent('#timer').setDuration(this.data.focusDuration)
  },

  /**
   * 格式化时长
   */
  formatDuration(seconds) {
    if (!seconds) return '0分钟'
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hours > 0) {
      return `${hours}小时${mins}分钟`
    }
    return `${mins}分钟`
  }
})
