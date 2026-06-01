const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// DeepSeek API 配置（OpenAI 兼容格式）
// 请在云函数环境变量中配置 DEEPSEEK_API_KEY，不要把 key 提交到代码仓库
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

/**
 * 学习监督 Agent 云函数
 * 调用 DeepSeek V4 分析姿势数据，提供个性化学习建议和方法推荐
 *
 * 隐私保护：
 * - 只接收姿势数值数据（yaw/pitch/roll），不接收任何图像
 * - 所有图像处理在客户端本地完成
 */
exports.main = async (event) => {
  const { action, context } = event

  if (!DEEPSEEK_API_KEY) {
    return {
      success: false,
      error: '未配置 DeepSeek API Key'
    }
  }

  try {
    let result

    switch (action) {
      case 'analyze':
        result = await analyzeSession(context)
        break
      case 'getAdvice':
        result = await getAdvice(context)
        break
      case 'adjustStrategy':
        result = await adjustStrategy(context)
        break
      default:
        return {
          success: false,
          error: `未知操作: ${action}`
        }
    }

    return {
      success: true,
      data: result
    }
  } catch (err) {
    console.error('Agent error:', err)
    return {
      success: false,
      error: err.message
    }
  }
}

/**
 * 调用 DeepSeek V4 API（OpenAI 兼容格式）
 * 仅发送姿势数据文本，不包含任何图像
 */
async function callDeepSeek(systemPrompt, userPrompt) {
  const response = await new Promise((resolve, reject) => {
    const https = require('https')
    const url = new URL(DEEPSEEK_API_URL)

    const postData = JSON.stringify({
      model: DEEPSEEK_MODEL,
      max_tokens: 2048,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'DeepSeek API 错误'))
            return
          }
          resolve(parsed)
        } catch (e) {
          reject(new Error('解析响应失败: ' + data.substring(0, 200)))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('请求超时')) })
    req.write(postData)
    req.end()
  })

  // 提取模型回复文本
  const content = response.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('DeepSeek 返回空内容')
  }

  // 尝试解析 JSON
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (e) {
    console.warn('JSON 解析失败，使用原始文本')
  }

  return { analysis: content, advice: [], strategyAdjustments: {}, insights: [], studyMethods: [] }
}

/**
 * 分析学习会话
 * 根据姿势时序数据、分心事件、历史记录生成个性化分析
 */
async function analyzeSession(context) {
  const { currentSession, recentRecords, userProfile, settings, postureTimeline, postureSummary, bodySummary } = context

  const systemPrompt = `你是一个专业的学习行为分析专家和人体工学顾问。你的任务是根据用户的脸部姿势数据（yaw/pitch/roll）和身体姿态数据（肩/髋/头关键点），综合分析学习状态，提供个性化建议和学习方法推荐。

## 重要原则
- 所有输入数据都是**姿势数值数据**，不是图像，你无法看到用户
- 你需要基于姿势数据的变化模式推断用户的学习状态和身体健康状况
- 建议应具体、可执行、个性化

## 输出格式
严格输出 JSON：
{
  "analysis": "对本次学习状态的综合分析（100-200字）",
  "advice": [
    { "title": "建议标题", "content": "具体内容", "icon": "star|warning|info|eye|leave|down|sleep|time|success" }
  ],
  "studyMethods": [
    { "name": "学习方法名称", "reason": "推荐理由（与用户数据关联）", "howTo": "具体实施步骤" }
  ],
  "strategyAdjustments": {
    "yawThreshold": 25, "pitchThreshold": 20, "focusDuration": 25,
    "breakDuration": 5, "faceLostTimeout": 3, "eyeCloseTimeout": 2,
    "shoulderTilt": 0.15, "headForward": 0.12, "spineLean": 0.15
  },
  "insights": ["对用户学习模式的洞察1", "洞察2"]
}

## 脸部数据分析方法
1. 姿势稳定性（postureStability）反映专注程度
2. 低头比例（headDownRatio）高 → 可能疲劳或学习材料位置不当
3. 视线偏离比例（lookAwayRatio）高 → 注意力分散
4. 人脸丢失比例（faceLostRatio）高 → 频繁离开座位
5. 姿势方差大 → 坐姿不安定，可能焦虑或不适

## 身体姿态数据分析方法
1. 高低肩（shoulderTilt）高 → 长时间单侧用力，可能桌面高度不当
2. 驼背比例（slouchRatio）高 → 核心肌群疲劳，椅子支撑不足
3. 头部前倾（headForward）大 → 屏幕过低或视力问题
4. 脊柱倾斜（spineLean）高 → 坐姿习惯不良，可能引发脊柱问题
5. 身体稳定性（bodyStability）低 → 频繁调整姿势，不适或分心
6. 姿势评分（postureScore）综合反映身体健康程度

## 分析方法论（脸+身体联合）
- 头部前倾 + 低头比例双高 → 屏幕位置严重不当，需调整显示器高度
- 驼背 + 低头 → 疲劳累积，需立即休息和拉伸
- 高低肩 + 身体稳定性低 → 桌椅不匹配，建议使用人体工学设备
- 身体稳定性高 + 脸部效率低 → 注意力问题而非身体问题

## 学习方法库
- 番茄工作法：25分钟专注+5分钟休息。适合注意力难以持续的人
- 间隔重复：按遗忘曲线复习。适合记忆类学习
- 主动回忆：合上书回忆内容。适合理解类学习
- 费曼学习法：用简单语言解释概念。适合深入理解
- 思维导图法：可视化知识结构。适合系统性学习
- SQ3R阅读法：浏览→提问→阅读→复述→复习。适合阅读类学习
- 康奈尔笔记法：分区记录。适合课堂/视频学习
- 刻意练习：专注弱项突破。适合技能类学习

请根据用户的姿势数据选择最适合的学习方法并说明理由。`

  const userPrompt = buildAnalyzePrompt(currentSession, recentRecords, userProfile, settings, postureTimeline, postureSummary, bodySummary)

  const result = await callDeepSeek(systemPrompt, userPrompt)

  return {
    analysis: result.analysis || '分析完成',
    advice: Array.isArray(result.advice) ? result.advice.slice(0, 4) : [],
    studyMethods: Array.isArray(result.studyMethods) ? result.studyMethods : [],
    strategyAdjustments: result.strategyAdjustments || {},
    insights: Array.isArray(result.insights) ? result.insights : []
  }
}

/**
 * 获取学习建议（含方法推荐）
 */
async function getAdvice(context) {
  const { stats, records, userProfile, postureSummary } = context

  const systemPrompt = `你是学习效率专家。根据学习数据和姿势分析，提供个性化建议和学习方法推荐。

输出 JSON：
{
  "advice": [
    { "title": "标题", "content": "具体可执行的建议", "icon": "star|warning|info|eye|leave|down|sleep|time|success" }
  ],
  "studyMethods": [
    { "name": "方法名", "reason": "推荐理由", "howTo": "如何执行" }
  ],
  "summary": "整体学习状态总结（50-100字）"
}
`

  const distractionStats = analyzeDistractions(records)
  const avgEfficiency = stats.sessionCount > 0
    ? Math.round((stats.focusDuration / stats.totalDuration) * 100)
    : 0

  const userPrompt = `用户学习数据：
- 今日学习：${Math.round(stats.totalDuration / 60)} 分钟，${stats.sessionCount} 次
- 平均效率：${avgEfficiency}%
- 分心次数：${stats.distractionCount} 次
- 分心分布：视线偏离 ${distractionStats.lookAway} 次，离开 ${distractionStats.faceLost} 次，低头 ${distractionStats.headDown} 次，闭眼 ${distractionStats.eyeClose} 次

姿势数据摘要：${postureSummary ? JSON.stringify(postureSummary) : '无'}

用户画像：${JSON.stringify(userProfile || {})}

请基于数据推荐学习方法。`

  const result = await callDeepSeek(systemPrompt, userPrompt)

  return {
    advice: Array.isArray(result.advice) ? result.advice : [],
    studyMethods: Array.isArray(result.studyMethods) ? result.studyMethods : [],
    summary: result.summary || ''
  }
}

/**
 * 调整学习策略
 */
async function adjustStrategy(context) {
  const { recentRecords, userProfile, currentSettings, postureSummary } = context

  const systemPrompt = `你是学习策略优化专家。根据用户表现调整检测参数。

输出 JSON：
{
  "strategyAdjustments": {
    "yawThreshold": 25, "pitchThreshold": 20, "focusDuration": 25,
    "breakDuration": 5, "faceLostTimeout": 3, "eyeCloseTimeout": 2
  },
  "reason": "调整原因",
  "insights": ["洞察"]
}

参数范围：
- yawThreshold: 15-45 度（转头阈值）
- pitchThreshold: 10-35 度（低头阈值）
- focusDuration: 15-90 分钟
- breakDuration: 3-20 分钟
- faceLostTimeout: 1-10 秒
- eyeCloseTimeout: 1-5 秒

策略：
- 姿势稳定、效率高 → 放宽阈值，延长专注时长
- 低头频繁 → 收紧 pitchThreshold
- 分心多 → 缩短 focusDuration，增加 breakDuration
- 人脸丢失多 → 放宽 faceLostTimeout`

  const avgEfficiency = calculateAvgEfficiency(recentRecords)
  const avgDistractionFreq = calculateDistractionFrequency(recentRecords)

  const userPrompt = `近期数据（${recentRecords.length} 次）：
- 平均效率：${avgEfficiency}%
- 分心频率：${avgDistractionFreq} 次/小时
- 分心类型 Top：${getTopDistractions(recentRecords)}

姿势摘要：${postureSummary ? JSON.stringify(postureSummary) : '无'}
当前设置：${JSON.stringify(currentSettings || {})}
用户画像：${JSON.stringify(userProfile || {})}

请调整策略参数。`

  const result = await callDeepSeek(systemPrompt, userPrompt)

  return {
    strategyAdjustments: result.strategyAdjustments || {},
    reason: result.reason || '',
    insights: Array.isArray(result.insights) ? result.insights : []
  }
}

// ============ 辅助函数 ============

/**
 * 构建分析请求的 user prompt
 */
function buildAnalyzePrompt(session, records, profile, settings, postureTimeline, postureSummary, bodySummary) {
  const duration = Math.round(session.duration / 60)
  const efficiency = session.efficiency || 0
  const distractionCount = session.distractions ? session.distractions.length : 0

  const recentStats = calculateRecentStats(records)
  const distractionStats = analyzeDistractions(records)

  // 生成脸部姿势摘要
  let postureSection = ''
  if (postureSummary && postureSummary.totalSamples > 0) {
    postureSection = `
## 脸部姿势数据（本次学习）
- 采样点：${postureSummary.totalSamples} 个（每2秒一次）
- 人脸丢失比例：${postureSummary.faceLostRatio}%（${postureSummary.faceLostCount}次）
- 平均头姿：yaw ${postureSummary.avgYaw}° / pitch ${postureSummary.avgPitch}° / roll ${postureSummary.avgRoll}°
- 最大偏离：yaw ${postureSummary.maxYawDeviation}° / pitch ${postureSummary.maxPitchDeviation}°
- 低头比例：${postureSummary.headDownRatio}%
- 视线偏离比例：${postureSummary.lookAwayRatio}%
- 脸部姿势稳定性：${postureSummary.postureStability}/100
`

    if (postureTimeline && postureTimeline.length > 0) {
      const sampled = postureTimeline.filter((_, i) => i % 10 === 0)
      postureSection += `- 姿势时间线（采样）：${sampled.length} 个点\n`
      postureSection += `  格式：[时间偏移(秒), yaw, pitch]\n`
      postureSection += `  数据：[${sampled.slice(0, 20).map(p =>
        `[${Math.round((p.timestamp - postureTimeline[0].timestamp) / 1000)},${p.yaw ?? '?'},${p.pitch ?? '?'}]`
      ).join(' ')}]\n`
    }
  }

  // 🔥 生成身体姿态摘要
  let bodySection = ''
  if (bodySummary && bodySummary.available) {
    bodySection = `
## 身体姿态数据（本次学习）
- 检测方式：VKSession 全身关键点（等价 MediaPipe Pose）
- 跟踪采样：${bodySummary.trackingSamples}/${bodySummary.totalSamples} 帧
- 高低肩指数：${bodySummary.avgShoulderTilt}（越高越不对称）
- 脊柱倾斜指数：${bodySummary.avgSpineLean}（越高越侧弯）
- 头部前倾指数：${bodySummary.avgHeadForward}（越高越前倾）
- 驼背比例：${bodySummary.slouchRatio}%
- 身体稳定性：${bodySummary.avgBodyStability}/100
- 综合姿势评分：${bodySummary.postureScore}/100
- 平均检测置信度：${bodySummary.avgConfidence}%
`
  } else if (bodySummary && !bodySummary.available) {
    bodySection = `
## 身体姿态数据
- 状态：VKSession 不可用（基础库版本过低或设备不支持）
- 本次仅有脸部数据可用
`
  }

  return `## 本次学习会话
- 学习时长：${duration} 分钟
- 综合效率：${efficiency}%
- 分心事件：${distractionCount} 次
- 分心类型：${session.distractions ? session.distractions.map(d => d.type).join('、') : '无'}

${postureSection}

## 近7天统计
- 学习次数：${recentStats.sessionCount} 次
- 总时长：${Math.round(recentStats.totalDuration / 3600)} 小时
- 平均效率：${recentStats.avgEfficiency}%
- 分心分布：视线偏离 ${distractionStats.lookAway} 次，离开 ${distractionStats.faceLost} 次，低头 ${distractionStats.headDown} 次，闭眼 ${distractionStats.eyeClose} 次

## 用户画像
${JSON.stringify(profile || {}, null, 2)}

${bodySection}

## 当前检测设置
${JSON.stringify(settings || {}, null, 2)}

请综合以上脸部+身体数据，分析用户的学习状态和身体健康状况，提供个性化建议，并推荐最适合的学习方法。`
}

function calculateRecentStats(records) {
  if (!records || records.length === 0) {
    return { sessionCount: 0, totalDuration: 0, avgEfficiency: 0 }
  }

  let totalDuration = 0
  let totalFocus = 0

  records.forEach(r => {
    totalDuration += r.duration || 0
    totalFocus += r.focusDuration || 0
  })

  return {
    sessionCount: records.length,
    totalDuration,
    avgEfficiency: totalDuration > 0 ? Math.round((totalFocus / totalDuration) * 100) : 0
  }
}

function analyzeDistractions(records) {
  const types = { lookAway: 0, faceLost: 0, headDown: 0, eyeClose: 0 }

  if (!records) return types

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

function calculateAvgEfficiency(records) {
  if (!records || records.length === 0) return 0

  let totalEfficiency = 0
  records.forEach(r => {
    totalEfficiency += r.efficiency || 0
  })

  return Math.round(totalEfficiency / records.length)
}

function calculateDistractionFrequency(records) {
  if (!records || records.length === 0) return 0

  let totalDistractions = 0
  let totalHours = 0

  records.forEach(r => {
    totalDistractions += r.distractions ? r.distractions.length : 0
    totalHours += (r.duration || 0) / 3600
  })

  return totalHours > 0 ? Math.round(totalDistractions / totalHours) : 0
}

function getTopDistractions(records) {
  const types = analyzeDistractions(records)
  const sorted = Object.entries(types).sort((a, b) => b[1] - a[1])

  const nameMap = {
    lookAway: '视线偏离',
    faceLost: '离开座位',
    headDown: '低头',
    eyeClose: '闭眼瞌睡'
  }

  return sorted
    .filter(([_, count]) => count > 0)
    .slice(0, 2)
    .map(([type, count]) => `${nameMap[type]}(${count}次)`)
    .join('，') || '无'
}
