/**
 * 学习监督 Agent 模块
 * 管理用户画像、调用 DeepSeek V4 分析姿势数据、执行策略调整
 * 隐私保护：仅发送姿势数值（yaw/pitch/roll），不发送任何图像数据
 */

const { getRecords, getDailyStats, getStatsRange, getToday, generateId } = require('./storage')

const KEYS = {
  USER_PROFILE: 'user_profile',
  AGENT_MEMORY: 'agent_memory'
}

class StudyAgent {
  constructor() {
    this.userProfile = null
    this.memory = []
    this.lastAnalysis = null
    this.isAnalyzing = false
  }

  /**
   * 初始化 Agent
   */
  async init() {
    this.loadProfile()
    this.loadMemory()

    // 如果没有用户画像，创建默认画像
    if (!this.userProfile) {
      this.userProfile = this.createDefaultProfile()
      this.saveProfile()
    }

    return this
  }

  /**
   * 创建默认用户画像
   */
  createDefaultProfile() {
    return {
      id: generateId(),
      createdAt: Date.now(),
      preferences: {
        preferredStudyTime: 'morning',
        preferredDuration: 25,
        breakPreference: 'short'
      },
      behaviorPatterns: {
        avgEfficiency: 0,
        commonDistractions: [],
        bestStudyHour: -1,
        fatigueThreshold: 90,
        distractionFrequency: 'low'
      },
      goals: {
        dailyTarget: 120,
        weeklyTarget: 600,
        focusImprovement: 80
      },
      insights: []
    }
  }

  /**
   * 加载用户画像
   */
  loadProfile() {
    try {
      this.userProfile = wx.getStorageSync(KEYS.USER_PROFILE) || null
    } catch (e) {
      console.error('加载用户画像失败:', e)
    }
  }

  /**
   * 保存用户画像
   */
  saveProfile() {
    try {
      wx.setStorageSync(KEYS.USER_PROFILE, this.userProfile)
    } catch (e) {
      console.error('保存用户画像失败:', e)
    }
  }

  /**
   * 加载记忆
   */
  loadMemory() {
    try {
      this.memory = wx.getStorageSync(KEYS.AGENT_MEMORY) || []
    } catch (e) {
      console.error('加载记忆失败:', e)
    }
  }

  /**
   * 保存记忆
   */
  saveMemory() {
    try {
      // 只保留最近 50 条记忆
      const recentMemory = this.memory.slice(-50)
      wx.setStorageSync(KEYS.AGENT_MEMORY, recentMemory)
    } catch (e) {
      console.error('保存记忆失败:', e)
    }
  }

  /**
   * 添加记忆
   */
  addMemory(type, content) {
    this.memory.push({
      type,
      content,
      timestamp: Date.now()
    })
    this.saveMemory()
  }

  /**
   * 分析学习会话（含姿势时序数据）
   * 将姿势数据（非图像）发送给 DeepSeek V4 进行分析
   */
  async analyze(currentSession) {
    if (this.isAnalyzing) {
      console.log('正在分析中，跳过...')
      return null
    }

    this.isAnalyzing = true

    try {
      const recentRecords = this.getRecentRecords(7)
      const settings = getApp().globalData.settings

      // 🔥 传递姿势时序数据（纯数据，无图像）
      const result = await this.callAgent('analyze', {
        currentSession,
        recentRecords,
        userProfile: this.userProfile,
        settings,
        postureTimeline: currentSession.postureTimeline || [],
        postureSummary: currentSession.postureSummary || null,
        bodySummary: currentSession.bodySummary || null
      })

      if (result.success) {
        this.lastAnalysis = result.data

        // 更新用户画像
        this.updateProfile(currentSession, result.data)

        // 添加记忆
        this.addMemory('analysis', result.data.analysis)

        return result.data
      }

      return null
    } catch (err) {
      console.error('Agent 分析失败:', err)
      return null
    } finally {
      this.isAnalyzing = false
    }
  }

  /**
   * 获取建议（含学习方法推荐）
   */
  async getAdvice(stats, records) {
    try {
      const result = await this.callAgent('getAdvice', {
        stats,
        records,
        userProfile: this.userProfile,
        postureSummary: stats.postureSummary || null
      })

      if (result.success) {
        return result.data
      }

      return null
    } catch (err) {
      console.error('获取建议失败:', err)
      return null
    }
  }

  /**
   * 调整策略
   */
  async adjustStrategy() {
    try {
      const recentRecords = this.getRecentRecords(7)
      const settings = getApp().globalData.settings

      const result = await this.callAgent('adjustStrategy', {
        recentRecords,
        userProfile: this.userProfile,
        currentSettings: settings
      })

      if (result.success) {
        // 应用策略调整
        if (result.data.strategyAdjustments) {
          this.applyStrategy(result.data.strategyAdjustments)
        }

        // 添加洞察
        if (result.data.insights) {
          result.data.insights.forEach(insight => {
            this.addInsight(insight)
          })
        }

        return result.data
      }

      return null
    } catch (err) {
      console.error('调整策略失败:', err)
      return null
    }
  }

  /**
   * 调用云端 Agent（带超时保护）
   * 云函数超时 20s，前端 15s 超时防止阻塞 UI
   */
  async callAgent(action, context) {
    const TIMEOUT_MS = 15000

    return new Promise((resolve, reject) => {
      let settled = false

      // 超时定时器
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true
          console.warn('Agent 调用超时 (' + action + ')')
          reject(new Error('请求超时，请检查网络'))
        }
      }, TIMEOUT_MS)

      wx.cloud.callFunction({
        name: 'studyAgent',
        data: { action, context },
        success: (res) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          if (res.result) {
            resolve(res.result)
          } else {
            reject(new Error('云端返回空结果'))
          }
        },
        fail: (err) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          console.error('云函数调用失败:', err.errMsg || err.message)
          reject(err)
        }
      })
    })
  }

  /**
   * 应用策略调整
   */
  applyStrategy(adjustments) {
    const app = getApp()
    const settings = { ...app.globalData.settings }

    // 应用调整（带范围限制）
    if (adjustments.yawThreshold) {
      settings.distractionThreshold.yaw = this.clamp(adjustments.yawThreshold, 15, 45)
    }
    if (adjustments.pitchThreshold) {
      settings.distractionThreshold.pitch = this.clamp(adjustments.pitchThreshold, 10, 35)
    }
    if (adjustments.focusDuration) {
      settings.focusDuration = this.clamp(adjustments.focusDuration, 15, 90) * 60
    }
    if (adjustments.breakDuration) {
      settings.breakDuration = this.clamp(adjustments.breakDuration, 3, 20) * 60
    }
    if (adjustments.faceLostTimeout) {
      settings.distractionThreshold.faceLostTimeout = this.clamp(adjustments.faceLostTimeout, 1, 10)
    }
    if (adjustments.eyeCloseTimeout) {
      settings.distractionThreshold.eyeCloseTimeout = this.clamp(adjustments.eyeCloseTimeout, 1, 5)
    }

    // 保存设置
    app.globalData.settings = settings
    const { saveSettings } = require('./storage')
    saveSettings(settings)

    return settings
  }

  /**
   * 更新用户画像
   */
  updateProfile(session, analysis) {
    if (!this.userProfile) return

    // 更新行为模式
    const patterns = this.userProfile.behaviorPatterns

    // 计算新的平均效率
    const totalSessions = (patterns.avgEfficiency > 0 ? 10 : 0) + 1
    patterns.avgEfficiency = Math.round(
      ((patterns.avgEfficiency * (totalSessions - 1)) + session.efficiency) / totalSessions
    )

    // 更新分心频率
    const distractionCount = session.distractions ? session.distractions.length : 0
    if (distractionCount > 5) {
      patterns.distractionFrequency = 'high'
    } else if (distractionCount > 2) {
      patterns.distractionFrequency = 'medium'
    } else {
      patterns.distractionFrequency = 'low'
    }

    // 更新常见分心类型
    if (session.distractions) {
      const typeCounts = {}
      session.distractions.forEach(d => {
        typeCounts[d.type] = (typeCounts[d.type] || 0) + 1
      })
      patterns.commonDistractions = Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([type]) => type)
    }

    // 保存画像
    this.saveProfile()
  }

  /**
   * 添加洞察
   */
  addInsight(content) {
    if (!this.userProfile) return

    this.userProfile.insights.push({
      date: getToday(),
      content,
      type: 'ai_insight'
    })

    // 只保留最近 20 条洞察
    this.userProfile.insights = this.userProfile.insights.slice(-20)
    this.saveProfile()
  }

  /**
   * 获取近期记录
   */
  getRecentRecords(days = 7) {
    const records = getRecords()
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    return records.filter(r => r.date >= cutoffStr)
  }

  /**
   * 数值范围限制
   */
  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
  }

  /**
   * 获取用户画像
   */
  getProfile() {
    return this.userProfile
  }

  /**
   * 获取最近的分析结果
   */
  getLastAnalysis() {
    return this.lastAnalysis
  }

  /**
   * 获取记忆
   */
  getMemory() {
    return this.memory
  }
}

// 创建单例
let agentInstance = null

/**
 * 获取 Agent 实例
 */
function getAgent() {
  if (!agentInstance) {
    agentInstance = new StudyAgent()
  }
  return agentInstance
}

/**
 * 初始化 Agent
 */
async function initAgent() {
  const agent = getAgent()
  await agent.init()
  return agent
}

module.exports = {
  StudyAgent,
  getAgent,
  initAgent
}
