const app = getApp()

Component({
  properties: {
    duration: {
      type: Number,
      value: 25 * 60 // 默认25分钟
    },
    isRunning: {
      type: Boolean,
      value: false
    }
  },

  data: {
    remainingTime: 0,
    displayTime: '25:00',
    progress: 0,
    mode: 'focus',
    focusMinutes: 25,
    breakMinutes: 5,
    timer: null
  },

  lifetimes: {
    attached() {
      this.setData({
        remainingTime: this.properties.duration,
        focusMinutes: Math.round(this.properties.duration / 60),
        breakMinutes: Math.round(app.globalData.settings.breakDuration / 60)
      })
      this.updateDisplay()
    },
    detached() {
      this.stopTimer()
    }
  },

  observers: {
    'isRunning': function(running) {
      if (running) {
        this.startTimer()
      } else {
        this.stopTimer()
      }
    }
  },

  methods: {
    /**
     * 开始计时
     */
    start() {
      this.startTimer()
    },

    /**
     * 暂停计时
     */
    pause() {
      this.stopTimer()
    },

    /**
     * 重置计时
     */
    reset() {
      this.stopTimer()
      this.setData({
        remainingTime: this.properties.duration,
        progress: 0
      })
      this.updateDisplay()
    },

    /**
     * 设置时长
     */
    setDuration(seconds) {
      this.setData({
        remainingTime: seconds,
        focusMinutes: Math.round(seconds / 60),
        progress: 0
      })
      this.updateDisplay()
    },

    /**
     * 切换模式
     */
    switchMode(e) {
      const mode = e.currentTarget.dataset.mode
      const duration = mode === 'focus'
        ? this.data.focusMinutes * 60
        : this.data.breakMinutes * 60

      this.setData({
        mode,
        remainingTime: duration
      })
      this.updateDisplay()
      this.triggerEvent('onmodechange', { mode, duration })
    },

    /**
     * 启动定时器
     */
    startTimer() {
      if (this.data.timer) return

      const timer = setInterval(() => {
        let remaining = this.data.remainingTime - 1

        if (remaining <= 0) {
          this.stopTimer()
          this.triggerEvent('oncomplete', { mode: this.data.mode })
          return
        }

        this.setData({ remainingTime: remaining })
        this.updateDisplay()
        this.triggerEvent('ontick', { remaining })
      }, 1000)

      this.setData({ timer })
    },

    /**
     * 停止定时器
     */
    stopTimer() {
      if (this.data.timer) {
        clearInterval(this.data.timer)
        this.setData({ timer: null })
      }
    },

    /**
     * 更新显示
     */
    updateDisplay() {
      const remaining = this.data.remainingTime
      const total = this.data.mode === 'focus'
        ? this.data.focusMinutes * 60
        : this.data.breakMinutes * 60

      const minutes = Math.floor(remaining / 60)
      const seconds = remaining % 60

      this.setData({
        displayTime: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
        progress: ((total - remaining) / total) * 100
      })
    }
  }
})
