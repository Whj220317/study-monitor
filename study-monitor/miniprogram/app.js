App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: 'cloud1-d0g7pmuik942ab9e4',
        traceUser: true
      })
    }

    // 🔥 启动时从本地存储加载已保存的设置
    this.loadSavedSettings()
  },

  globalData: {
    userInfo: null,
    settings: {
      focusDuration: 25 * 60,    // 专注时长（秒）
      breakDuration: 5 * 60,     // 休息时长（秒）
      distractionThreshold: {
        yaw: 25,                 // 左右转头阈值（度）
        pitch: 20,               // 低头阈值（度）
        faceLostTimeout: 3,      // 人脸丢失超时（秒）
        eyeCloseTimeout: 2       // 闭眼超时（秒）
      },
      soundEnabled: true,
      vibrationEnabled: true
    }
  },

  /**
   * 🔥 从本地存储加载已保存的设置
   * 用户通过设置页修改的参数优先于默认值
   */
  loadSavedSettings() {
    try {
      const savedSettings = wx.getStorageSync('app_settings')
      if (savedSettings && typeof savedSettings === 'object') {
        // 合并设置：保留默认结构的完整性，用已保存的值覆盖
        const defaults = this.globalData.settings
        this.globalData.settings = {
          focusDuration: savedSettings.focusDuration ?? defaults.focusDuration,
          breakDuration: savedSettings.breakDuration ?? defaults.breakDuration,
          distractionThreshold: {
            yaw: savedSettings.distractionThreshold?.yaw ?? defaults.distractionThreshold.yaw,
            pitch: savedSettings.distractionThreshold?.pitch ?? defaults.distractionThreshold.pitch,
            faceLostTimeout: savedSettings.distractionThreshold?.faceLostTimeout ?? defaults.distractionThreshold.faceLostTimeout,
            eyeCloseTimeout: savedSettings.distractionThreshold?.eyeCloseTimeout ?? defaults.distractionThreshold.eyeCloseTimeout
          },
          soundEnabled: savedSettings.soundEnabled ?? defaults.soundEnabled,
          vibrationEnabled: savedSettings.vibrationEnabled ?? defaults.vibrationEnabled
        }
        console.log('已加载保存的设置:', JSON.stringify(this.globalData.settings))
      } else {
        console.log('无已保存的设置，使用默认值')
      }
    } catch (e) {
      console.error('加载设置失败:', e)
    }
  }
})
