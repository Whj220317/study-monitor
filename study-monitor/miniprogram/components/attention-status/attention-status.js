const { getStatusText } = require('../../utils/detector')

Component({
  properties: {
    status: {
      type: String,
      value: 'focus'
    },
    distractionCount: {
      type: Number,
      value: 0
    },
    efficiency: {
      type: Number,
      value: 100
    }
  },

  data: {
    statusText: '专注中'
  },

  observers: {
    'status': function(status) {
      this.setData({
        statusText: getStatusText(status)
      })
    }
  }
})
