const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

/**
 * 生成学习报告云函数
 * 汇总学习数据，生成分析报告
 */
exports.main = async (event) => {
  const { userId, startDate, endDate } = event

  try {
    // 获取学习记录
    const records = await getRecords(userId, startDate, endDate)

    // 计算统计数据
    const stats = calculateStats(records)

    // 生成建议
    const advice = generateAdvice(stats)

    return {
      success: true,
      data: {
        stats,
        advice,
        recordCount: records.length
      }
    }
  } catch (err) {
    console.error('Generate report error:', err)
    return {
      success: false,
      error: err.message
    }
  }
}

/**
 * 获取学习记录
 */
async function getRecords(userId, startDate, endDate) {
  try {
    const result = await db.collection('study_records')
      .where({
        userId,
        date: db.command.gte(startDate).and(db.command.lte(endDate))
      })
      .orderBy('date', 'asc')
      .get()

    return result.data
  } catch (err) {
    // 如果集合不存在，返回空数组
    console.log('Collection not found or error:', err.message)
    return []
  }
}

/**
 * 计算统计数据
 */
function calculateStats(records) {
  if (records.length === 0) {
    return {
      totalDuration: 0,
      focusDuration: 0,
      sessionCount: 0,
      avgEfficiency: 0,
      distractionCount: 0,
      distractionTypes: {
        look_away: 0,
        face_lost: 0,
        head_down: 0,
        eye_close: 0
      },
      bestDay: null,
      worstDay: null
    }
  }

  let totalDuration = 0
  let focusDuration = 0
  let distractionCount = 0
  let totalEfficiency = 0
  const distractionTypes = {
    look_away: 0,
    face_lost: 0,
    head_down: 0,
    eye_close: 0
  }

  const dailyStats = {}

  records.forEach(record => {
    totalDuration += record.duration || 0
    focusDuration += record.focusDuration || 0
    distractionCount += (record.distractions || []).length
    totalEfficiency += record.efficiency || 0

    // 统计分心类型
    ;(record.distractions || []).forEach(d => {
      if (distractionTypes[d.type] !== undefined) {
        distractionTypes[d.type]++
      }
    })

    // 每日统计
    if (!dailyStats[record.date]) {
      dailyStats[record.date] = {
        date: record.date,
        duration: 0,
        efficiency: 0,
        count: 0
      }
    }
    dailyStats[record.date].duration += record.duration || 0
    dailyStats[record.date].efficiency += record.efficiency || 0
    dailyStats[record.date].count++
  })

  // 计算每日平均效率
  Object.values(dailyStats).forEach(day => {
    day.avgEfficiency = day.count > 0 ? Math.round(day.efficiency / day.count) : 0
  })

  // 找出最好和最差的一天
  const days = Object.values(dailyStats)
  const bestDay = days.reduce((best, day) =>
    day.avgEfficiency > (best?.avgEfficiency || 0) ? day : best, null)
  const worstDay = days.reduce((worst, day) =>
    day.avgEfficiency < (worst?.avgEfficiency || 100) ? day : worst, null)

  return {
    totalDuration,
    focusDuration,
    sessionCount: records.length,
    avgEfficiency: records.length > 0 ? Math.round(totalEfficiency / records.length) : 0,
    distractionCount,
    distractionTypes,
    bestDay: bestDay ? bestDay.date : null,
    worstDay: worstDay ? worstDay.date : null
  }
}

/**
 * 生成建议
 */
function generateAdvice(stats) {
  const advice = []

  if (stats.sessionCount === 0) {
    return [{
      type: 'start',
      title: '开始学习',
      content: '还没有学习记录，点击开始按钮开启专注学习。'
    }]
  }

  // 效率建议
  if (stats.avgEfficiency < 60) {
    advice.push({
      type: 'efficiency',
      title: '提升专注力',
      content: '当前学习效率较低，建议尝试番茄工作法，每25分钟专注学习后休息5分钟。'
    })
  }

  // 分心类型建议
  if (stats.distractionTypes.look_away > 10) {
    advice.push({
      type: 'focus',
      title: '减少视觉干扰',
      content: '检测到频繁转头，建议清理桌面，将手机放在视线正前方。'
    })
  }

  if (stats.distractionTypes.eye_close > 5) {
    advice.push({
      type: 'rest',
      title: '注意休息',
      content: '检测到多次闭眼，可能学习时间过长或睡眠不足，建议适当休息。'
    })
  }

  if (stats.distractionTypes.face_lost > 5) {
    advice.push({
      type: 'environment',
      title: '改善学习环境',
      content: '检测到频繁离开，建议提前准备好学习用品，减少中途离开。'
    })
  }

  return advice
}
