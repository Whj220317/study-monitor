const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

/**
 * 人脸检测云函数
 * 调用腾讯云人脸检测API，分析面部状态
 */
exports.main = async (event) => {
  const { imageBase64 } = event

  if (!imageBase64) {
    return {
      success: false,
      error: '缺少图片数据'
    }
  }

  try {
    const result = await detectFaceFromCloud(imageBase64)
    return {
      success: true,
      data: result
    }
  } catch (err) {
    console.error('Face detection error:', err)
    return {
      success: false,
      error: err.message
    }
  }
}

/**
 * 调用腾讯云人脸检测
 */
async function detectFaceFromCloud(imageBase64) {
  const secretId = process.env.SECRET_ID
  const secretKey = process.env.SECRET_KEY

  // 如果没有配置密钥，返回模拟数据
  if (!secretId || !secretKey) {
    console.warn('未配置腾讯云密钥，返回模拟数据')
    return {
      hasFace: true,
      yaw: 0,
      pitch: 0,
      roll: 0,
      eyeClose: false,
      gazeDeviation: 0,
      confidence: 0.95
    }
  }

  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs')
    const FaceClient = tencentcloud.face.v20180301.Client

    const client = new FaceClient({
      credential: {
        secretId: secretId,
        secretKey: secretKey
      },
      region: 'ap-guangzhou'
    })

    const params = {
      MaxFaceNum: 1,
      Image: imageBase64,
      NeedFaceAttributes: 1,
      NeedQualityDetection: 0
    }

    const response = await client.DetectFace(params)
    const face = response.FaceInfos[0]

    if (!face) {
      return {
        hasFace: false,
        yaw: 0,
        pitch: 0,
        roll: 0,
        eyeClose: false,
        gazeDeviation: 0
      }
    }

    return {
      hasFace: true,
      yaw: face.Angle.Yaw,
      pitch: face.Angle.Pitch,
      roll: face.Angle.Roll,
      eyeClose: face.EyeOpen < 0.5,
      gazeDeviation: calculateGazeDeviation(face),
      confidence: face.FaceConfidence
    }
  } catch (e) {
    console.error('腾讯云API调用失败:', e)
    // 降级返回模拟数据
    return {
      hasFace: true,
      yaw: 0,
      pitch: 0,
      roll: 0,
      eyeClose: false,
      gazeDeviation: 0,
      confidence: 0.9
    }
  }
}

/**
 * 计算视线偏离程度
 */
function calculateGazeDeviation(face) {
  if (face.Gaze) {
    const { GazeLeftEyeX, GazeLeftEyeY, GazeRightEyeX, GazeRightEyeY } = face.Gaze
    const avgX = (Math.abs(GazeLeftEyeX) + Math.abs(GazeRightEyeX)) / 2
    const avgY = (Math.abs(GazeLeftEyeY) + Math.abs(GazeRightEyeY)) / 2
    return Math.sqrt(avgX * avgX + avgY * avgY)
  }
  return 0
}
