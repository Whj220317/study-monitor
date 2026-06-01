const { getStatsRange, getDailyStats, getToday } = require('../../utils/storage')
const { generateAdvice, getStudyMethods, analyzeDistractions, matchStudyMethods } = require('../../utils/advice')
const { initAgent, getAgent } = require('../../utils/agent')

Page({
  data: {
    // 日期
    currentDate: null,
    dateRangeText: '',
    weekStart: null,
    weekEnd: null,

    // 统计
    weekStats: {
      totalHours: '0',
      sessionCount: 0,
      avgEfficiency: 0,
      distractionCount: 0
    },

    // 图表数据
    weekData: [],
    efficiencyConnectors: [],
    distractionStats: [],
    adviceList: [],
    studyMethods: [],
    postureSummary: null,   // 姿势数据摘要
    postureQuality: null    // 姿势质量评分
  },

  agent: null,

  async onLoad() {
    this.setData({
      currentDate: new Date()
    })

    // 初始化 Agent
    try {
      this.agent = await initAgent()
    } catch (err) {
      console.error('Agent 初始化失败:', err)
    }

    this.loadWeekData()
  },

  onShow() {
    this.loadWeekData()
  },

  /**
   * 加载周数据
   */
  async loadWeekData() {
    const { weekStart, weekEnd } = this.getWeekRange(this.data.currentDate)
    const stats = getStatsRange(
      this.formatDate(weekStart),
      this.formatDate(weekEnd)
    )

    // 计算周统计
    let totalSeconds = 0
    let sessionCount = 0
    let totalEfficiency = 0
    let distractionCount = 0
    let efficiencyCount = 0

    stats.forEach(day => {
      totalSeconds += day.totalDuration || 0
      sessionCount += day.sessionCount || 0
      distractionCount += day.distractionCount || 0
      if (day.efficiency > 0) {
        totalEfficiency += day.efficiency
        efficiencyCount++
      }
    })

    const maxHours = Math.max(...stats.map(d => (d.totalDuration || 0) / 3600), 0.5)
    const dayLabels = ['日', '一', '二', '三', '四', '五', '六']

    const weekData = stats.map((day, index) => {
      const hours = (day.totalDuration || 0) / 3600
      const date = new Date(day.date)
      const eff = day.efficiency || 0
      // 预计算 WXML 不支持的方法调用和嵌套三元
      const dotLeft = ((index * 100) / 6).toFixed(1)
      let effClass = 'eff-low'
      if (eff >= 80) effClass = 'eff-high'
      else if (eff >= 60) effClass = 'eff-mid'
      return {
        date: day.date,
        dayLabel: dayLabels[date.getDay()],
        hours: hours.toFixed(1),
        hoursText: hours > 0 ? hours.toFixed(1) + 'h' : '-',
        barHeight: Math.max(Math.round((hours / maxHours) * 100), hours > 0 ? 4 : 0),
        efficiency: eff,
        hasData: hours > 0,
        hasEfficiency: eff > 0,
        dotLeft: dotLeft,
        effClass: effClass
      }
    })

    // 🔥 效率趋势连线计算
    const efficiencyConnectors = []
    let prevIdx = -1
    for (let i = 0; i < weekData.length; i++) {
      if (weekData[i].hasEfficiency) {
        if (prevIdx >= 0) {
          // 计算两个有效数据点之间的连线
          const fromEff = weekData[prevIdx].efficiency
          const toEff = weekData[i].efficiency
          const steps = i - prevIdx
          const stepLength = 100 / 6  // 7个点之间6段
          efficiencyConnectors.push({
            fromIndex: prevIdx,
            toIndex: i,
            fromLeft: Math.round(prevIdx * stepLength + stepLength / 2),
            toLeft: Math.round(i * stepLength + stepLength / 2),
            fromBottom: fromEff,
            toBottom: toEff,
            angle: Math.atan2((toEff - fromEff), (i - prevIdx) * stepLength) * (180 / Math.PI),
            length: Math.sqrt(Math.pow((i - prevIdx) * stepLength, 2) + Math.pow(toEff - fromEff, 2)),
            trend: toEff > fromEff ? 'up' : toEff < fromEff ? 'down' : 'flat',
            trendColor: toEff > fromEff ? '#27AE60' : toEff < fromEff ? '#E74C3C' : '#999'
          })
        }
        prevIdx = i
      }
    }

    // 🔥 聚合分心类型 + 姿势数据（反映学习者真实状态）
    const records = this.getWeekRecords()
    const distractionTypes = analyzeDistractions(records)

    // 聚合所有记录的姿势摘要数据
    let postureSummary = this.aggregatePostureData(records)
    this.setData({ postureSummary })

    // 有姿势数据时，用姿势比例计算分心分布（更精确）
    let totalDistractions
    let lookAwayCount, faceLostCount, headDownCount, eyeCloseCount

    if (postureSummary && postureSummary.totalSamples > 0) {
      // 🔥 用姿势数据驱动：从 yaw/pitch 实际采样比例计算
      headDownCount = Math.round(postureSummary.headDownRatio * postureSummary.totalSamples / 100)
      lookAwayCount = Math.round(postureSummary.lookAwayRatio * postureSummary.totalSamples / 100)
      faceLostCount = postureSummary.faceLostCount
      eyeCloseCount = distractionTypes.eyeClose  // 闭眼目前仍需从事件获取
      totalDistractions = headDownCount + lookAwayCount + faceLostCount + eyeCloseCount || 1
    } else {
      // 回退：用事件计数
      lookAwayCount = distractionTypes.lookAway
      faceLostCount = distractionTypes.faceLost
      headDownCount = distractionTypes.headDown
      eyeCloseCount = distractionTypes.eyeClose
      totalDistractions = Object.values(distractionTypes).reduce((a, b) => a + b, 0) || 1
    }

    // 🔥 根据学习者真实状态确定各类型的严重程度颜色
    const distColorMap = {
      high: '#E74C3C',    // 高占比 → 红色警告
      medium: '#F39C12',  // 中占比 → 橙色关注
      low: '#27AE60'      // 低占比 → 绿色正常
    }

    const getDistLevel = (count, total) => {
      const ratio = total > 0 ? count / total : 0
      return ratio > 0.3 ? 'high' : ratio > 0.15 ? 'medium' : 'low'
    }

    const distractionStats = [
      {
        type: 'look_away',
        name: '视线偏离',
        icon: '👀',
        count: lookAwayCount,
        percentage: Math.round((lookAwayCount / totalDistractions) * 100),
        level: getDistLevel(lookAwayCount, totalDistractions),
        color: distColorMap[getDistLevel(lookAwayCount, totalDistractions)],
        detail: postureSummary ? `平均偏离 ${postureSummary.maxYawDeviation}°` : ''
      },
      {
        type: 'head_down',
        name: '低头',
        icon: '⬇️',
        count: headDownCount,
        percentage: Math.round((headDownCount / totalDistractions) * 100),
        level: getDistLevel(headDownCount, totalDistractions),
        color: distColorMap[getDistLevel(headDownCount, totalDistractions)],
        detail: postureSummary ? `平均角度 ${postureSummary.avgPitch}°` : ''
      },
      {
        type: 'face_lost',
        name: '离开座位',
        icon: '🚪',
        count: faceLostCount,
        percentage: Math.round((faceLostCount / totalDistractions) * 100),
        level: getDistLevel(faceLostCount, totalDistractions),
        color: distColorMap[getDistLevel(faceLostCount, totalDistractions)],
        detail: postureSummary ? `丢失率 ${postureSummary.faceLostRatio}%` : ''
      },
      {
        type: 'eye_close',
        name: '闭眼/瞌睡',
        icon: '😴',
        count: eyeCloseCount,
        percentage: Math.round((eyeCloseCount / totalDistractions) * 100),
        level: getDistLevel(eyeCloseCount, totalDistractions),
        color: distColorMap[getDistLevel(eyeCloseCount, totalDistractions)],
        detail: ''
      }
    ]

    // 按真实占比从高到低排序
    distractionStats.sort((a, b) => b.count - a.count)

    // 生成建议
    const weekStatsData = {
      totalDuration: totalSeconds,
      sessionCount,
      efficiency: efficiencyCount > 0 ? Math.round(totalEfficiency / efficiencyCount) : 0,
      distractionCount
    }

    // 🔥 先用本地数据立即渲染，Agent 结果异步更新
    let adviceList = generateAdvice(weekStatsData, records)
    let studyMethods = matchStudyMethods(postureSummary, weekStatsData)

    // 异步请求 Agent（不阻塞页面渲染）
    if (this.agent) {
      this.agent.getAdvice(weekStatsData, records).then(agentAdvice => {
        if (agentAdvice) {
          const updates = {}
          if (agentAdvice.advice && agentAdvice.advice.length > 0) {
            updates.adviceList = agentAdvice.advice.map(a => ({
              ...a,
              iconEmoji: iconMap[a.icon] || '💡'
            }))
          }
          if (agentAdvice.studyMethods && agentAdvice.studyMethods.length > 0) {
            updates.studyMethods = agentAdvice.studyMethods
          }
          if (Object.keys(updates).length > 0) {
            this.setData(updates)
          }
        }
      }).catch(err => {
        console.error('Agent 建议获取失败（已使用本地建议）:', err.message)
      })
    }

    // 🔥 姿势质量评分（基于聚合数据）
    const postureQuality = postureSummary ? {
      stability: postureSummary.postureStability || 0,
      stabilityLabel: postureSummary.postureStability > 80 ? '优秀' : postureSummary.postureStability > 60 ? '良好' : postureSummary.postureStability > 40 ? '一般' : '需改善',
      stabilityColor: postureSummary.postureStability > 80 ? '#27AE60' : postureSummary.postureStability > 60 ? '#4A90D9' : postureSummary.postureStability > 40 ? '#F39C12' : '#E74C3C',
      avgHeadAngle: `${postureSummary.avgPitch || 0}°`,
      maxDeviation: `${postureSummary.maxYawDeviation || 0}°`,
      totalSamples: postureSummary.totalSamples || 0
    } : null

    const iconMap = {
      star: '⭐',
      warning: '⚠️',
      info: 'ℹ️',
      eye: '👁',
      leave: '🚪',
      down: '⬇️',
      sleep: '😴',
      time: '⏰',
      clock: '🕐',
      success: '✅'
    }
    const adviceWithIcons = adviceList.map(a => ({
      ...a,
      iconEmoji: iconMap[a.icon] || '💡'
    }))

    this.setData({
      weekStart,
      weekEnd,
      dateRangeText: `${this.formatDateShort(weekStart)} - ${this.formatDateShort(weekEnd)}`,
      weekStats: {
        totalHours: (totalSeconds / 3600).toFixed(1),
        sessionCount,
        avgEfficiency: weekStatsData.efficiency,
        distractionCount
      },
      weekData,
      efficiencyConnectors,
      distractionStats,
      postureQuality,
      adviceList: adviceWithIcons,
      studyMethods
    })
  },

  /**
   * 获取周记录
   */
  getWeekRecords() {
    const { getRecords } = require('../../utils/storage')
    const allRecords = getRecords()
    const weekStart = this.data.weekStart
    const weekEnd = this.data.weekEnd

    if (!weekStart || !weekEnd) return []

    return allRecords.filter(r => {
      const date = new Date(r.date)
      return date >= weekStart && date <= weekEnd
    })
  },

  /**
   * 获取周范围
   */
  getWeekRange(date) {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)

    const weekStart = new Date(d)
    weekStart.setDate(diff)
    weekStart.setHours(0, 0, 0, 0)

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)

    return { weekStart, weekEnd }
  },

  /**
   * 格式化日期（完整格式，用于数据查询）
   */
  formatDate(date) {
    if (!date) return ''
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  /**
   * 格式化日期（简短格式，用于显示）
   */
  formatDateShort(date) {
    if (!date) return ''
    const d = new Date(date)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${month}-${day}`
  },

  /**
   * 上一周
   */
  prevWeek() {
    const d = new Date(this.data.currentDate)
    d.setDate(d.getDate() - 7)
    this.setData({ currentDate: d })
    this.loadWeekData()
  },

  /**
   * 下一周
   */
  nextWeek() {
    const d = new Date(this.data.currentDate)
    d.setDate(d.getDate() + 7)
    this.setData({ currentDate: d })
    this.loadWeekData()
  },

  /**
   * 回到今天
   */
  goToday() {
    this.setData({ currentDate: new Date() })
    this.loadWeekData()
  },

  /**
   * 🔥 聚合周记录中的姿势摘要数据
   * 将多次学习的姿势数据合并为周度综合指标
   */
  aggregatePostureData(records) {
    if (!records || records.length === 0) return null

    const hasPosture = records.filter(r => r.postureSummary && r.postureSummary.totalSamples > 0)
    if (hasPosture.length === 0) return null

    let totalSamples = 0
    let totalFaceLost = 0
    let totalHeadDown = 0
    let totalLookAway = 0
    let weightedStability = 0
    let sumAvgYaw = 0
    let sumAvgPitch = 0
    let maxYawDev = 0
    let maxPitchDev = 0

    hasPosture.forEach(r => {
      const ps = r.postureSummary
      const weight = ps.detectedSamples || ps.totalSamples || 0

      totalSamples += ps.totalSamples || 0
      totalFaceLost += ps.faceLostCount || 0
      totalHeadDown += Math.round((ps.headDownRatio || 0) * (ps.detectedSamples || 1) / 100)
      totalLookAway += Math.round((ps.lookAwayRatio || 0) * (ps.detectedSamples || 1) / 100)
      weightedStability += (ps.postureStability || 0) * weight
      sumAvgYaw += Math.abs(ps.avgYaw || 0) * weight
      sumAvgPitch += Math.abs(ps.avgPitch || 0) * weight

      if ((ps.maxYawDeviation || 0) > maxYawDev) maxYawDev = ps.maxYawDeviation
      if ((ps.maxPitchDeviation || 0) > maxPitchDev) maxPitchDev = ps.maxPitchDeviation
    })

    const totalWeight = hasPosture.reduce((s, r) => s + (r.postureSummary.detectedSamples || r.postureSummary.totalSamples || 0), 0) || 1

    return {
      totalSamples,
      faceLostCount: totalFaceLost,
      faceLostRatio: totalSamples > 0 ? Math.round((totalFaceLost / totalSamples) * 100) : 0,
      headDownRatio: totalSamples > 0 ? Math.round((totalHeadDown / totalSamples) * 100) : 0,
      lookAwayRatio: totalSamples > 0 ? Math.round((totalLookAway / totalSamples) * 100) : 0,
      postureStability: Math.round(weightedStability / totalWeight),
      avgYaw: Math.round((sumAvgYaw / totalWeight) * 100) / 100,
      avgPitch: Math.round((sumAvgPitch / totalWeight) * 100) / 100,
      maxYawDeviation: Math.round(maxYawDev * 100) / 100,
      maxPitchDeviation: Math.round(maxPitchDev * 100) / 100,
      sessionCount: hasPosture.length
    }
  }
})
