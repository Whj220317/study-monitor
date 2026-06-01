/**
 * 学习建议生成引擎
 */

/**
 * 根据学习记录生成建议
 * @param {Object} stats - 统计数据
 * @param {Array} records - 学习记录列表
 * @returns {Array} 建议列表
 */
function generateAdvice(stats, records) {
  const advice = []

  if (!stats || stats.sessionCount === 0) {
    return [{
      type: 'welcome',
      title: '开始你的学习之旅',
      content: '点击"开始学习"按钮，开启专注模式。建议先从25分钟的番茄钟开始。',
      icon: 'star'
    }]
  }

  // 分析分心类型
  const distractionTypes = analyzeDistractions(records)

  // 基于效率的建议
  if (stats.efficiency < 60) {
    advice.push({
      type: 'efficiency',
      title: '学习效率较低',
      content: '当前专注度不足60%，建议：1) 找一个安静的学习环境；2) 将手机调至静音；3) 使用番茄工作法，每25分钟休息5分钟。',
      icon: 'warning'
    })
  } else if (stats.efficiency < 80) {
    advice.push({
      type: 'efficiency',
      title: '效率有提升空间',
      content: '专注度约' + stats.efficiency + '%，还不错！尝试在学习前设定明确目标，有助于提高专注力。',
      icon: 'info'
    })
  }

  // 基于分心类型的建议
  if (distractionTypes.lookAway > 5) {
    advice.push({
      type: 'look_away',
      title: '频繁转头/视线偏离',
      content: '检测到你经常看向别处。建议：1) 清理桌面，减少视觉干扰；2) 将学习材料放在摄像头正前方；3) 使用"白噪音"帮助集中注意力。',
      icon: 'eye'
    })
  }

  if (distractionTypes.faceLost > 3) {
    advice.push({
      type: 'face_lost',
      title: '频繁离开座位',
      content: '检测到你多次离开学习区域。建议：1) 学习前准备好水和零食；2) 设定"不可离开"的承诺时间；3) 离开超过1分钟时暂停计时。',
      icon: 'leave'
    })
  }

  if (distractionTypes.headDown > 5) {
    advice.push({
      type: 'head_down',
      title: '频繁低头',
      content: '长时间低头容易疲劳。建议：1) 调整手机/平板角度，保持平视；2) 每20分钟活动一下颈部；3) 使用手机支架。',
      icon: 'down'
    })
  }

  if (distractionTypes.eyeClose > 3) {
    advice.push({
      type: 'eye_close',
      title: '检测到困倦',
      content: '学习过程中出现闭眼/瞌睡。建议：1) 保证充足睡眠（7-8小时）；2) 学习前喝杯水；3) 困倦时起身活动5分钟；4) 调整学习时间到精力充沛的时段。',
      icon: 'sleep'
    })
  }

  // 基于学习时长的建议
  if (stats.totalDuration > 3 * 60 * 60) {
    advice.push({
      type: 'long_session',
      title: '学习时间较长',
      content: '今日已学习超过3小时，记得适当休息。长时间学习后，大脑需要休息来巩固记忆。建议每学习50分钟休息10分钟。',
      icon: 'time'
    })
  }

  // 基于学习时段的建议
  const timeAdvice = analyzeTimePattern(records)
  if (timeAdvice) {
    advice.push(timeAdvice)
  }

  // 通用建议
  if (advice.length === 0) {
    advice.push({
      type: 'good',
      title: '状态不错！',
      content: '保持当前的学习节奏。记得定时休息，保持良好的学习习惯。',
      icon: 'success'
    })
  }

  return advice
}

/**
 * 分析分心类型统计
 */
function analyzeDistractions(records) {
  const types = {
    lookAway: 0,
    faceLost: 0,
    headDown: 0,
    eyeClose: 0
  }

  records.forEach(record => {
    if (record.distractions) {
      record.distractions.forEach(d => {
        switch (d.type) {
          case 'look_away':
          case 'yaw':
            types.lookAway++
            break
          case 'face_lost':
            types.faceLost++
            break
          case 'head_down':
          case 'pitch':
            types.headDown++
            break
          case 'eye_close':
            types.eyeClose++
            break
        }
      })
    }
  })

  return types
}

/**
 * 分析学习时间模式
 */
function analyzeTimePattern(records) {
  if (records.length < 3) return null

  const hourCounts = new Array(24).fill(0)
  const hourDistractions = new Array(24).fill(0)

  records.forEach(record => {
    const hour = new Date(record.startTime).getHours()
    hourCounts[hour]++
    hourDistractions[hour] += record.distractions ? record.distractions.length : 0
  })

  // 找出分心最多的时段
  let worstHour = -1
  let worstRate = 0
  for (let i = 0; i < 24; i++) {
    if (hourCounts[i] >= 2) {
      const rate = hourDistractions[i] / hourCounts[i]
      if (rate > worstRate) {
        worstRate = rate
        worstHour = i
      }
    }
  }

  if (worstHour >= 0 && worstRate > 3) {
    const timeStr = worstHour < 12 ? `上午${worstHour}点` : `下午${worstHour}点`
    return {
      type: 'time_pattern',
      title: `${timeStr}时段效率较低`,
      content: `你在${timeStr}左右学习时分心较多，建议将重要内容安排在其他时段，或在这个时段做轻松的复习。`,
      icon: 'clock'
    }
  }

  return null
}

/**
 * 获取学习方法推荐（本地回退库）
 * 优先使用 DeepSeek V4 的个性化推荐，此库作为离线回退
 */
function getStudyMethods() {
  return [
    {
      name: '番茄工作法',
      description: '25分钟专注 + 5分钟休息，每4个番茄后长休息15-30分钟',
      suitable: '适合需要长时间学习但容易疲劳的人',
      steps: '1) 设定25分钟计时器 2) 全神贯注学习 3) 响铃后休息5分钟 4) 每4轮后长休息'
    },
    {
      name: '间隔重复',
      description: '按照遗忘曲线安排复习：1天后、3天后、7天后、14天后',
      suitable: '适合记忆类学习（背单词、公式、概念）',
      steps: '1) 学习新内容当天记录 2) 第1/3/7/14天分别复习 3) 每次复习标记掌握程度 4) 调整下次复习间隔'
    },
    {
      name: '主动回忆',
      description: '学习后合上书本，尝试回忆内容，比反复阅读更有效',
      suitable: '适合理解类学习（数学、物理、编程）',
      steps: '1) 学习一段内容 2) 合上书本 3) 在纸上写出/画出你记住的内容 4) 对比原文查漏补缺'
    },
    {
      name: '费曼学习法',
      description: '用简单的语言向别人解释概念，发现自己的知识盲点',
      suitable: '适合深入理解复杂概念',
      steps: '1) 选择要学习的概念 2) 假装讲给一个完全不懂的人 3) 遇到卡壳的地方回去学 4) 简化类比，用自己的话表述'
    },
    {
      name: '思维导图法',
      description: '用可视化方式整理知识结构，构建知识网络',
      suitable: '适合系统性学习、考前复习',
      steps: '1) 中心主题写在中间 2) 按分支展开子主题 3) 用关键词和连线表示关系 4) 定期回顾补充'
    },
    {
      name: 'SQ3R 阅读法',
      description: 'Survey→Question→Read→Recite→Review',
      suitable: '适合阅读教材、论文、技术文档',
      steps: '1) 浏览目录和标题 2) 提出问题 3) 带着问题精读 4) 复述内容 5) 定期复习'
    },
    {
      name: '康奈尔笔记法',
      description: '将笔记分为三个区域：线索区、笔记区、总结区',
      suitable: '适合听课、看视频教程',
      steps: '1) 笔记区记录主要内容 2) 线索区写下关键词和问题 3) 总结区用自己的话概括 4) 遮住笔记区，只看线索回忆'
    },
    {
      name: '刻意练习',
      description: '针对薄弱环节进行高强度、有反馈的专项训练',
      suitable: '适合技能类学习（编程、乐器、体育）',
      steps: '1) 明确要提升的具体技能 2) 设计有挑战的练习任务 3) 获得即时反馈 4) 重复修正直至自动化'
    }
  ]
}

/**
 * 根据姿势数据选择最匹配的学习方法
 * DeepSeek V4 离线时的本地回退算法
 */
function matchStudyMethods(postureSummary, stats) {
  const methods = getStudyMethods()
  const matched = []

  // 基于姿势数据的匹配规则
  if (postureSummary) {
    // 低头比例高 → 疲劳，推荐番茄工作法
    if (postureSummary.headDownRatio > 20) {
      const pomodoro = methods.find(m => m.name === '番茄工作法')
      if (pomodoro) matched.push({ ...pomodoro, reason: '检测到频繁低头，可能学习疲劳。番茄工作法强制休息节奏有助于缓解疲劳。' })
    }

    // 姿势稳定性低 → 注意力分散，推荐主动回忆
    if (postureSummary.postureStability < 60) {
      const activeRecall = methods.find(m => m.name === '主动回忆')
      if (activeRecall && !matched.find(m => m.name === '主动回忆')) {
        matched.push({ ...activeRecall, reason: '坐姿不够稳定，可能注意力分散。主动回忆能提高学习参与度。' })
      }
    }

    // 人脸丢失多 → 频繁离开，推荐番茄工作法设定承诺时间
    if (postureSummary.faceLostRatio > 15) {
      const sq3r = methods.find(m => m.name === 'SQ3R 阅读法')
      if (sq3r && !matched.find(m => m.name === 'SQ3R 阅读法')) {
        matched.push({ ...sq3r, reason: '频繁离开座位，SQ3R 的结构化流程能帮你保持学习节奏。' })
      }
    }

    // 视线偏离多 → 注意力不集中
    if (postureSummary.lookAwayRatio > 25) {
      const mindmap = methods.find(m => m.name === '思维导图法')
      if (mindmap && !matched.find(m => m.name === '思维导图法')) {
        matched.push({ ...mindmap, reason: '频繁视线偏离，思维导图将抽象内容可视化，有助于保持视觉焦点。' })
      }
    }
  }

  // 基于效率的规则
  if (stats) {
    if (stats.efficiency < 60) {
      const feynman = methods.find(m => m.name === '费曼学习法')
      if (feynman && !matched.find(m => m.name === '费曼学习法')) {
        matched.push({ ...feynman, reason: '当前学习效率较低，费曼学习法通过"教是最好的学"来加深理解。' })
      }
    }

    if (stats.totalDuration > 2 * 60 * 60) {
      const spaced = methods.find(m => m.name === '间隔重复')
      if (spaced && !matched.find(m => m.name === '间隔重复')) {
        matched.push({ ...spaced, reason: '长时间学习后，间隔重复能科学巩固记忆。' })
      }
    }
  }

  // 确保至少有1个推荐
  if (matched.length === 0) {
    matched.push({
      ...methods[0],
      reason: '番茄工作法是验证最广泛的学习方法，适合大多数人入门。'
    })
  }

  return matched.slice(0, 3)
}

module.exports = {
  generateAdvice,
  analyzeDistractions,
  getStudyMethods,
  matchStudyMethods
}
