const { getSettings, saveSettings, KEYS } = require('../../utils/storage')
const { initAgent, getAgent } = require('../../utils/agent')

const app = getApp()

Page({
  data: {
    // 时间设置
    focusMinutes: 25,
    breakMinutes: 5,
    focusOptions: ['15', '20', '25', '30', '45', '60', '90'],
    focusIndex: 2,
    breakOptions: ['3', '5', '10', '15', '20'],
    breakIndex: 1,

    // 检测灵敏度
    yawThreshold: 25,
    pitchThreshold: 20,
    faceLostTimeout: 3,
    timeoutOptions: ['1', '2', '3', '5', '10'],
    timeoutIndex: 2,

    // 提醒设置
    vibrationEnabled: true,
    soundEnabled: true,

    // AI 设置
    aiEnabled: true,
    aiAnalyzing: false,
    userProfile: null,
    agentInsights: []
  },

  agent: null,

  async onLoad() {
    this.loadSettings()

    // 初始化 Agent
    try {
      this.agent = await initAgent()
      this.loadAgentData()
    } catch (err) {
      console.error('Agent 初始化失败:', err)
    }
  },

  /**
   * 加载设置
   */
  loadSettings() {
    const settings = getSettings()
    if (settings) {
      const focusIndex = this.data.focusOptions.indexOf(String(settings.focusDuration / 60))
      const breakIndex = this.data.breakOptions.indexOf(String(settings.breakDuration / 60))
      const timeoutIndex = this.data.timeoutOptions.indexOf(String(settings.distractionThreshold.faceLostTimeout))

      this.setData({
        focusMinutes: settings.focusDuration / 60,
        breakMinutes: settings.breakDuration / 60,
        focusIndex: focusIndex >= 0 ? focusIndex : 2,
        breakIndex: breakIndex >= 0 ? breakIndex : 1,
        yawThreshold: settings.distractionThreshold.yaw,
        pitchThreshold: settings.distractionThreshold.pitch,
        faceLostTimeout: settings.distractionThreshold.faceLostTimeout,
        timeoutIndex: timeoutIndex >= 0 ? timeoutIndex : 2,
        vibrationEnabled: settings.vibrationEnabled,
        soundEnabled: settings.soundEnabled
      })
    }
  },

  /**
   * 加载 Agent 数据
   */
  loadAgentData() {
    if (!this.agent) return

    const profile = this.agent.getProfile()
    if (profile) {
      this.setData({
        userProfile: profile,
        agentInsights: profile.insights || []
      })
    }
  },

  /**
   * 保存设置
   */
  saveCurrentSettings() {
    const settings = {
      focusDuration: this.data.focusMinutes * 60,
      breakDuration: this.data.breakMinutes * 60,
      distractionThreshold: {
        yaw: this.data.yawThreshold,
        pitch: this.data.pitchThreshold,
        faceLostTimeout: this.data.faceLostTimeout,
        eyeCloseTimeout: 2
      },
      vibrationEnabled: this.data.vibrationEnabled,
      soundEnabled: this.data.soundEnabled
    }

    saveSettings(settings)
    app.globalData.settings = settings
  },

  /**
   * 专注时长变化
   */
  onFocusChange(e) {
    const index = e.detail.value
    this.setData({
      focusIndex: index,
      focusMinutes: parseInt(this.data.focusOptions[index])
    })
    this.saveCurrentSettings()
  },

  /**
   * 休息时长变化
   */
  onBreakChange(e) {
    const index = e.detail.value
    this.setData({
      breakIndex: index,
      breakMinutes: parseInt(this.data.breakOptions[index])
    })
    this.saveCurrentSettings()
  },

  /**
   * 转头阈值变化
   */
  onYawChange(e) {
    this.setData({ yawThreshold: e.detail.value })
    this.saveCurrentSettings()
  },

  /**
   * 低头阈值变化
   */
  onPitchChange(e) {
    this.setData({ pitchThreshold: e.detail.value })
    this.saveCurrentSettings()
  },

  /**
   * 离开超时变化
   */
  onTimeoutChange(e) {
    const index = e.detail.value
    this.setData({
      timeoutIndex: index,
      faceLostTimeout: parseInt(this.data.timeoutOptions[index])
    })
    this.saveCurrentSettings()
  },

  /**
   * 震动开关
   */
  onVibrationChange(e) {
    this.setData({ vibrationEnabled: e.detail.value })
    this.saveCurrentSettings()
  },

  /**
   * 声音开关
   */
  onSoundChange(e) {
    this.setData({ soundEnabled: e.detail.value })
    this.saveCurrentSettings()
  },

  /**
   * 导出数据
   */
  exportData() {
    const records = wx.getStorageSync(KEYS.RECORDS) || []
    const plans = wx.getStorageSync(KEYS.PLANS) || []
    const stats = wx.getStorageSync(KEYS.DAILY_STATS) || {}

    let text = '=== 学习监督 - 数据报告 ===\n'
    text += `导出时间：${this.formatDate(new Date())}\n\n`

    // 每日统计
    text += '【每日学习统计】\n'
    const sortedDates = Object.keys(stats).sort().reverse()
    if (sortedDates.length === 0) {
      text += '暂无学习记录\n'
    } else {
      sortedDates.forEach(date => {
        const s = stats[date]
        const hours = (s.totalDuration / 3600).toFixed(1)
        const efficiency = s.efficiency || 0
        text += `${date}：学习 ${hours} 小时，${s.sessionCount} 次，效率 ${efficiency}%\n`
      })
    }

    // 学习计划
    text += '\n【学习计划】\n'
    if (plans.length === 0) {
      text += '暂无学习计划\n'
    } else {
      plans.forEach(p => {
        const statusMap = {
          pending: '未开始',
          in_progress: '进行中',
          completed: '已完成'
        }
        const status = statusMap[p.status] || '未开始'
        text += `${p.title}（${status}）\n`
        if (p.description) text += `  说明：${p.description}\n`
      })
    }

    // 学习记录详情
    text += '\n【学习记录详情】\n'
    if (records.length === 0) {
      text += '暂无学习记录\n'
    } else {
      const sortedRecords = records.sort((a, b) => new Date(b.date) - new Date(a.date))
      sortedRecords.forEach(r => {
        const duration = (r.duration / 60).toFixed(0)
        const focusDuration = (r.focusDuration / 60).toFixed(0)
        const efficiency = r.duration > 0 ? Math.round((r.focusDuration / r.duration) * 100) : 0
        const startTimeStr = r.startTime ? this.formatTimestamp(r.startTime) : ''
        text += `${r.date} ${startTimeStr}\n`
        text += `  时长：${duration} 分钟，专注：${focusDuration} 分钟，效率：${efficiency}%\n`
        if (r.distractions && r.distractions.length > 0) {
          text += `  分心次数：${r.distractions.length} 次\n`
        }
      })
    }

    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
      }
    })
  },

  /**
   * 格式化日期
   */
  formatDate(date) {
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  },

  /**
   * 格式化时间戳
   */
  formatTimestamp(timestamp) {
    const d = new Date(timestamp)
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  },

  /**
   * 清除数据
   */
  clearData() {
    wx.showModal({
      title: '确认清除',
      content: '此操作将删除所有学习记录和计划，且无法恢复。确定要清除吗？',
      confirmColor: '#E74C3C',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync(KEYS.RECORDS)
          wx.removeStorageSync(KEYS.PLANS)
          wx.removeStorageSync(KEYS.DAILY_STATS)
          wx.showToast({ title: '已清除所有数据', icon: 'success' })
        }
      }
    })
  },

  /**
   * 生成测试数据
   */
  seedData() {
    wx.showModal({
      title: '生成测试数据',
      content: '将生成最近一周的模拟学习数据（含姿势数据），用于查看报告图表。\n\n提示：原有数据不会被覆盖。',
      success: (res) => {
        if (res.confirm) {
          const { seedTestData } = require('../../utils/storage')
          const result = seedTestData()
          wx.showToast({
            title: `已生成 ${result.recordCount} 条记录`,
            icon: 'success'
          })
        }
      }
    })
  },

  /**
   * 验证存储数据
   */
  verifyData() {
    const { verifyStorageData, getRecords } = require('../../utils/storage')
    const result = verifyStorageData()

    let content = '📊 本地存储数据检查\n\n'
    content += `学习记录：${result.recordCount} 条`
    if (result.recordsWithPosture > 0) content += `（${result.recordsWithPosture}条含姿势数据）`
    content += '\n'
    content += `统计天数：${result.statDays} 天\n`
    content += `学习计划：${result.hasPlans ? result.hasPlans.length || '有' : '无'}\n`
    content += `应用设置：${result.hasSettings ? '已保存' : '使用默认'}\n`
    content += `分心事件：${result.totalDistractions} 次\n\n`

    if (result.hasRecords) {
      content += '✅ 数据正常，报告页可以展示图表'
    } else {
      content += '⚠️ 暂无学习记录，建议先完成学习或生成测试数据'
    }

    wx.showModal({
      title: '存储验证',
      content,
      showCancel: false
    })
  },

  /**
   * 显示隐私说明
   */
  showPrivacy() {
    wx.showModal({
      title: '隐私说明',
      content: '🔒 隐私保护\n\n1. 摄像头画面完全在本地处理，不上传任何图像到服务器\n\n2. 仅提取姿势数值（头部角度数据）发送给 DeepSeek V4 AI 进行分析，无法还原人脸\n\n3. 学习数据仅存储在您的设备上，可随时清除\n\n4. 不收集任何个人身份信息',
      showCancel: false
    })
  },

  /**
   * AI 策略调整
   */
  async adjustStrategy() {
    if (!this.agent) {
      wx.showToast({ title: 'Agent 未初始化', icon: 'none' })
      return
    }

    this.setData({ aiAnalyzing: true })

    try {
      const result = await this.agent.adjustStrategy()

      if (result) {
        // 应用策略调整
        if (result.strategyAdjustments) {
          const newSettings = this.agent.applyStrategy(result.strategyAdjustments)

          // 更新界面显示
          const focusIndex = this.data.focusOptions.indexOf(String(newSettings.focusDuration / 60))
          const breakIndex = this.data.breakOptions.indexOf(String(newSettings.breakDuration / 60))
          const timeoutIndex = this.data.timeoutOptions.indexOf(String(newSettings.distractionThreshold.faceLostTimeout))

          this.setData({
            focusMinutes: newSettings.focusDuration / 60,
            breakMinutes: newSettings.breakDuration / 60,
            focusIndex: focusIndex >= 0 ? focusIndex : this.data.focusIndex,
            breakIndex: breakIndex >= 0 ? breakIndex : this.data.breakIndex,
            yawThreshold: newSettings.distractionThreshold.yaw,
            pitchThreshold: newSettings.distractionThreshold.pitch,
            faceLostTimeout: newSettings.distractionThreshold.faceLostTimeout,
            timeoutIndex: timeoutIndex >= 0 ? timeoutIndex : this.data.timeoutIndex
          })
        }

        // 显示调整原因
        if (result.reason) {
          wx.showModal({
            title: 'AI 策略调整',
            content: result.reason,
            showCancel: false
          })
        }

        // 更新洞察
        if (result.insights && result.insights.length > 0) {
          this.loadAgentData()
        }
      } else {
        wx.showToast({ title: '调整失败，请稍后重试', icon: 'none' })
      }
    } catch (err) {
      console.error('策略调整失败:', err)
      wx.showToast({ title: '调整失败', icon: 'none' })
    } finally {
      this.setData({ aiAnalyzing: false })
    }
  },

  /**
   * 显示用户画像
   */
  showProfile() {
    if (!this.agent) {
      wx.showToast({ title: 'Agent 未初始化', icon: 'none' })
      return
    }

    const profile = this.agent.getProfile()
    if (!profile) {
      wx.showToast({ title: '暂无用户画像', icon: 'none' })
      return
    }

    const patterns = profile.behaviorPatterns || {}
    const goals = profile.goals || {}

    let content = '【学习偏好】\n'
    content += `偏好专注时长：${profile.preferences?.preferredDuration || 25} 分钟\n`
    content += `偏好学习时段：${this.getTimeLabel(profile.preferences?.preferredStudyTime)}\n\n`

    content += '【行为模式】\n'
    content += `平均效率：${patterns.avgEfficiency || 0}%\n`
    content += `分心频率：${this.getFrequencyLabel(patterns.distractionFrequency)}\n`
    content += `常见分心：${patterns.commonDistractions?.join('、') || '无'}\n\n`

    content += '【学习目标】\n'
    content += `每日目标：${goals.dailyTarget || 120} 分钟\n`
    content += `目标专注度：${goals.focusImprovement || 80}%`

    wx.showModal({
      title: '用户画像',
      content,
      showCancel: false
    })
  },

  /**
   * 显示洞察记录
   */
  showInsights() {
    const insights = this.data.agentInsights

    if (!insights || insights.length === 0) {
      wx.showToast({ title: '暂无洞察记录', icon: 'none' })
      return
    }

    const content = insights.slice(-5).map(i => `${i.date}: ${i.content}`).join('\n\n')

    wx.showModal({
      title: 'AI 洞察',
      content,
      showCancel: false
    })
  },

  /**
   * 获取时段标签
   */
  getTimeLabel(time) {
    const map = {
      morning: '上午',
      afternoon: '下午',
      evening: '晚上',
      night: '深夜'
    }
    return map[time] || '未知'
  },

  /**
   * 获取频率标签
   */
  getFrequencyLabel(freq) {
    const map = {
      low: '低',
      medium: '中',
      high: '高'
    }
    return map[freq] || '未知'
  },

  /**
   * AI 开关变化
   */
  onAiEnabledChange(e) {
    this.setData({ aiEnabled: e.detail.value })
    // 这里可以添加启用/禁用 Agent 的逻辑
  }
})
