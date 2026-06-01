const { getPlans, savePlan, deletePlan, generateId } = require('../../utils/storage')

Page({
  data: {
    plans: [],
    showForm: false,
    isEditing: false,
    editingId: null,
    formTitle: '',
    formDuration: '25',
    quickDurations: [
      { label: '15分钟', value: 15 },
      { label: '25分钟', value: 25 },
      { label: '45分钟', value: 45 },
      { label: '60分钟', value: 60 },
      { label: '90分钟', value: 90 }
    ]
  },

  onShow() {
    this.loadPlans()
  },

  /**
   * 加载计划列表
   */
  loadPlans() {
    const plans = getPlans()
    this.setData({
      plans: plans.map(p => ({
        ...p,
        statusText: this.getStatusText(p.status),
        targetText: this.formatDuration(p.targetDuration),
        progress: this.calcProgress(p),
        progressText: this.getProgressText(p)
      }))
    })
  },

  /**
   * 获取状态文本
   */
  getStatusText(status) {
    const map = {
      pending: '未开始',
      in_progress: '进行中',
      completed: '已完成'
    }
    return map[status] || '未开始'
  },

  /**
   * 计算进度
   */
  calcProgress(plan) {
    if (!plan.targetDuration || plan.targetDuration === 0) return 0
    return Math.min(100, Math.round((plan.completedDuration || 0) / plan.targetDuration * 100))
  },

  /**
   * 获取进度文本
   */
  getProgressText(plan) {
    const completed = this.formatDuration(plan.completedDuration || 0)
    const target = this.formatDuration(plan.targetDuration)
    return `${completed} / ${target}`
  },

  /**
   * 格式化时长
   */
  formatDuration(seconds) {
    if (!seconds) return '0分钟'
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hours > 0) {
      return `${hours}小时${mins > 0 ? mins + '分钟' : ''}`
    }
    return `${mins}分钟`
  },

  /**
   * 显示添加表单
   */
  showAddForm() {
    this.setData({
      showForm: true,
      isEditing: false,
      editingId: null,
      formTitle: '',
      formDuration: '25'
    })
  },

  /**
   * 隐藏表单
   */
  hideForm() {
    this.setData({ showForm: false })
  },

  /**
   * 标题输入
   */
  onTitleInput(e) {
    this.setData({ formTitle: e.detail.value })
  },

  /**
   * 时长输入
   */
  onDurationInput(e) {
    this.setData({ formDuration: e.detail.value })
  },

  /**
   * 快捷设置时长
   */
  setQuickDuration(e) {
    this.setData({ formDuration: String(e.currentTarget.dataset.value) })
  },

  /**
   * 提交计划
   */
  submitPlan() {
    const { formTitle, formDuration, isEditing, editingId } = this.data

    if (!formTitle.trim()) {
      wx.showToast({ title: '请输入计划名称', icon: 'none' })
      return
    }

    const duration = parseInt(formDuration)
    if (isNaN(duration) || duration <= 0) {
      wx.showToast({ title: '请输入有效的时长', icon: 'none' })
      return
    }

    const plan = {
      id: isEditing ? editingId : generateId(),
      title: formTitle.trim(),
      targetDuration: duration * 60,
      completedDuration: isEditing ? this.getCompletedDuration(editingId) : 0,
      status: isEditing ? this.getPlanStatus(editingId) : 'pending',
      createdAt: isEditing ? this.getPlanCreatedAt(editingId) : Date.now(),
      updatedAt: Date.now()
    }

    savePlan(plan)
    this.hideForm()
    this.loadPlans()

    wx.showToast({
      title: isEditing ? '修改成功' : '创建成功',
      icon: 'success'
    })
  },

  /**
   * 获取已完成时长
   */
  getCompletedDuration(id) {
    const plans = getPlans()
    const plan = plans.find(p => p.id === id)
    return plan ? plan.completedDuration || 0 : 0
  },

  /**
   * 获取计划状态
   */
  getPlanStatus(id) {
    const plans = getPlans()
    const plan = plans.find(p => p.id === id)
    return plan ? plan.status || 'pending' : 'pending'
  },

  /**
   * 获取创建时间
   */
  getPlanCreatedAt(id) {
    const plans = getPlans()
    const plan = plans.find(p => p.id === id)
    return plan ? plan.createdAt : Date.now()
  },

  /**
   * 编辑计划
   */
  editPlan(e) {
    const plan = e.currentTarget.dataset.plan
    this.setData({
      showForm: true,
      isEditing: true,
      editingId: plan.id,
      formTitle: plan.title,
      formDuration: String(Math.round(plan.targetDuration / 60))
    })
  },

  /**
   * 删除计划
   */
  deletePlan(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除这个计划吗？',
      success: (res) => {
        if (res.confirm) {
          deletePlan(id)
          this.loadPlans()
          wx.showToast({ title: '已删除', icon: 'success' })
        }
      }
    })
  },

  /**
   * 开始学习
   */
  startPlan(e) {
    const plan = e.currentTarget.dataset.plan
    // 将计划信息存入全局数据
    const app = getApp()
    app.globalData.pendingPlan = plan

    // 跳转到首页
    wx.switchTab({
      url: '/pages/index/index'
    })
  }
})
