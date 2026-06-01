/**
 * 数据存储工具
 */

const KEYS = {
  RECORDS: 'study_records',
  PLANS: 'study_plans',
  SETTINGS: 'app_settings',
  DAILY_STATS: 'daily_stats'
}

/**
 * 获取学习记录
 */
function getRecords(date) {
  const allRecords = wx.getStorageSync(KEYS.RECORDS) || []
  if (date) {
    return allRecords.filter(r => r.date === date)
  }
  return allRecords
}

/**
 * 保存学习记录
 */
function saveRecord(record) {
  const records = getRecords()
  records.push(record)
  wx.setStorageSync(KEYS.RECORDS, records)
  updateDailyStats(record)
}

/**
 * 获取学习计划
 */
function getPlans() {
  return wx.getStorageSync(KEYS.PLANS) || []
}

/**
 * 保存学习计划
 */
function savePlan(plan) {
  const plans = getPlans()
  const index = plans.findIndex(p => p.id === plan.id)
  if (index >= 0) {
    plans[index] = plan
  } else {
    plans.push(plan)
  }
  wx.setStorageSync(KEYS.PLANS, plans)
}

/**
 * 删除学习计划
 */
function deletePlan(planId) {
  const plans = getPlans().filter(p => p.id !== planId)
  wx.setStorageSync(KEYS.PLANS, plans)
}

/**
 * 获取设置
 */
function getSettings() {
  return wx.getStorageSync(KEYS.SETTINGS) || null
}

/**
 * 保存设置
 */
function saveSettings(settings) {
  wx.setStorageSync(KEYS.SETTINGS, settings)
}

/**
 * 获取今日统计
 */
function getDailyStats(date) {
  const stats = wx.getStorageSync(KEYS.DAILY_STATS) || {}
  return stats[date] || {
    totalDuration: 0,
    focusDuration: 0,
    distractionCount: 0,
    sessionCount: 0,
    efficiency: 0
  }
}

/**
 * 更新每日统计
 */
function updateDailyStats(record) {
  const stats = wx.getStorageSync(KEYS.DAILY_STATS) || {}
  const date = record.date
  const current = stats[date] || {
    totalDuration: 0,
    focusDuration: 0,
    distractionCount: 0,
    sessionCount: 0,
    efficiency: 0
  }

  current.totalDuration += record.duration
  current.focusDuration += record.focusDuration
  current.distractionCount += record.distractions.length
  current.sessionCount += 1
  current.efficiency = Math.round((current.focusDuration / current.totalDuration) * 100) || 0

  stats[date] = current
  wx.setStorageSync(KEYS.DAILY_STATS, stats)
}

/**
 * 获取指定日期范围的统计
 */
function getStatsRange(startDate, endDate) {
  const stats = wx.getStorageSync(KEYS.DAILY_STATS) || {}
  const result = []
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    result.push({
      date: dateStr,
      ...(stats[dateStr] || {
        totalDuration: 0,
        focusDuration: 0,
        distractionCount: 0,
        sessionCount: 0,
        efficiency: 0
      })
    })
  }
  return result
}

/**
 * 生成唯一ID
 */
function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

/**
 * 生成今天日期字符串
 */
function getToday() {
  return new Date().toISOString().split('T')[0]
}

/**
 * 生成测试数据（本周一到周日，含姿势数据）
 * 方便开发时查看图表效果，数据直接覆盖本周
 */
function seedTestData() {
  const today = new Date()
  const records = []
  const dailyStats = {}

  // 计算本周一
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(today)
  monday.setDate(monday.getDate() + mondayOffset)
  monday.setHours(0, 0, 0, 0)

  // 为本周7天生成模拟数据
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]

    // 跳过今天（还没学习）和随机跳过1天（模拟休息日）
    const isToday = dateStr === today.toISOString().split('T')[0]
    if (isToday || (i > 3 && Math.random() > 0.6)) continue

    // 每有数据的天，时长递增（模拟学习习惯养成）
    const baseMinutes = 25 + i * 5
    const sessionCount = 1 + Math.floor(Math.random() * 2)
    let dayTotalDuration = 0
    let dayFocusDuration = 0
    let dayDistractions = 0

    for (let s = 0; s < sessionCount; s++) {
      const duration = (baseMinutes + Math.floor(Math.random() * 20)) * 60
      const efficiency = 55 + Math.floor(Math.random() * 40) + i * 2  // 越往后效率越高
      const clampedEff = Math.min(96, efficiency)
      const focusDuration = Math.round(duration * clampedEff / 100)
      const distractionTypePool = ['look_away', 'head_down', 'face_lost', 'eye_close']
      const distractionCount = Math.max(0, Math.floor(Math.random() * 5) - Math.floor(i / 2))  // 分心递减
      const distractions = []
      for (let di = 0; di < distractionCount; di++) {
        distractions.push({
          type: distractionTypePool[Math.floor(Math.random() * distractionTypePool.length)],
          timestamp: d.getTime() + s * 3600000 + Math.floor(Math.random() * duration * 1000)
        })
      }

      const sampleCount = Math.round(duration / 2)
      const faceLostCount = Math.round(sampleCount * (0.02 + Math.random() * 0.08))
      const headDownRatio = Math.round(5 + Math.random() * 25)
      const lookAwayRatio = Math.round(8 + Math.random() * 25)
      const postureStability = Math.round(55 + Math.random() * 40 + i * 1.5) // 姿势逐渐改善

      records.push({
        id: 'seed_' + dateStr + '_' + s + '_' + Math.random().toString(36).substr(2, 6),
        date: dateStr,
        planId: null,
        startTime: d.getTime() + s * 3600000 + (9 + s) * 3600000,
        endTime: d.getTime() + s * 3600000 + (9 + s) * 3600000 + duration * 1000,
        duration: duration,
        focusDuration: focusDuration,
        distractions: distractions,
        efficiency: clampedEff,
        postureTimeline: [],
        postureSummary: {
          totalSamples: sampleCount,
          detectedSamples: sampleCount - faceLostCount,
          faceLostCount: faceLostCount,
          faceLostRatio: Math.round((faceLostCount / Math.max(sampleCount, 1)) * 100),
          headDownRatio: Math.min(100, headDownRatio),
          lookAwayRatio: Math.min(100, lookAwayRatio),
          postureStability: Math.min(100, postureStability),
          avgYaw: Math.round((Math.random() * 6 - 3) * 100) / 100,
          avgPitch: Math.round((5 + Math.random() * 10) * 100) / 100,
          avgRoll: Math.round((Math.random() * 2 - 1) * 100) / 100,
          maxYawDeviation: Math.round((10 + Math.random() * 25) * 100) / 100,
          maxPitchDeviation: Math.round((8 + Math.random() * 20) * 100) / 100
        }
      })

      dayTotalDuration += duration
      dayFocusDuration += focusDuration
      dayDistractions += distractionCount
    }

    dailyStats[dateStr] = {
      totalDuration: dayTotalDuration,
      focusDuration: dayFocusDuration,
      distractionCount: dayDistractions,
      sessionCount: sessionCount,
      efficiency: dayTotalDuration > 0 ? Math.round((dayFocusDuration / dayTotalDuration) * 100) : 0
    }
  }

  // 写入本地存储（追加模式，不覆盖已有数据）
  const existingRecords = wx.getStorageSync('study_records') || []
  const newRecords = existingRecords.filter(r => !r.id || !r.id.startsWith('seed_'))
  const mergedRecords = [...newRecords, ...records]
  wx.setStorageSync('study_records', mergedRecords)

  const existingStats = wx.getStorageSync('daily_stats') || {}
  // 种子数据覆盖对应日期的统计
  const mergedStats = { ...existingStats, ...dailyStats }
  wx.setStorageSync('daily_stats', mergedStats)

  console.log('测试数据已生成:', records.length + '条记录, ' + Object.keys(dailyStats).length + '天统计')

  return {
    recordCount: records.length,
    dayCount: Object.keys(dailyStats).length
  }
}

/**
 * 验证数据完整性
 */
function verifyStorageData() {
  const records = wx.getStorageSync('study_records') || []
  const stats = wx.getStorageSync('daily_stats') || {}
  const plans = wx.getStorageSync('study_plans') || []
  const settings = wx.getStorageSync('app_settings') || null

  const result = {
    hasRecords: records.length > 0,
    recordCount: records.length,
    hasStats: Object.keys(stats).length > 0,
    statDays: Object.keys(stats).length,
    hasPlans: plans.length > 0,
    hasSettings: settings !== null,
    recordsWithPosture: records.filter(r => r.postureSummary && r.postureSummary.totalSamples > 0).length,
    totalDistractions: records.reduce((s, r) => s + (r.distractions?.length || 0), 0)
  }

  console.log('存储验证:', JSON.stringify(result))
  return result
}

module.exports = {
  KEYS,
  getRecords,
  saveRecord,
  getPlans,
  savePlan,
  deletePlan,
  getSettings,
  saveSettings,
  getDailyStats,
  getStatsRange,
  generateId,
  getToday,
  seedTestData,
  verifyStorageData
}
