# 学习监督小程序（study-monitor）

基于微信小程序 + 微信云开发的学习监督工具，通过摄像头检测学习姿势（低头/转头/闭眼/离开），结合 DeepSeek AI 提供个性化学习建议。

## 功能
- 番茄钟 + 学习计时
- 实时人脸/身体姿态检测
- 分心事件记录（低头、转头、闭眼、离开）
- 每日/周学习报告
- AI 个性化建议（DeepSeek 驱动）

## 技术栈
- **前端**：原生微信小程序（JS / WXML / WXSS）
- **后端**：微信云开发（云函数 + 云数据库）
- **AI**：DeepSeek API

## 目录结构
```
study-monitor/
├── miniprogram/        # 小程序前端
│   ├── pages/          # 页面（学习/计划/报告/设置）
│   ├── components/     # 组件（计时器/统计图表等）
│   ├── utils/          # 工具类（检测器/存储/AI 客户端）
│   └── app.js          # 入口
└── cloudfunctions/     # 云函数
    ├── detectFace      # 人脸检测（腾讯云 API）
    ├── generateReport  # 报告生成
    └── studyAgent      # AI Agent（DeepSeek 驱动）
```

## 部署

### 前置
1. 微信开发者工具（最新稳定版）
2. 已开通微信云开发
3. AppID：`wxsdfsdfsdfsd`（替换为你自己的）

### 步骤
1. 用微信开发者工具打开本目录
2. `miniprogram/` 上传 → 微信公众平台提交审核
3. `cloudfunctions/*` 三个云函数分别右键 → **上传并部署：云端安装依赖**
4. 云开发控制台创建数据库集合：`study_records`、`user_profile`
5. 云函数 `studyAgent` 配置环境变量：
   - `DEEPSEEK_API_KEY` = 你的 DeepSeek key
   - `SECRET_ID` / `SECRET_KEY`（腾讯云人脸检测，可选）

## 本地运行
1. 克隆项目
2. 微信开发者工具 → 导入项目 → 选择本目录
3. AppID 选择「测试号」或填入自己的
4. 在云开发面板创建环境，复制环境 ID 替换 `miniprogram/app.js` 中的 `env`

## 隐私说明
- 所有图像处理在客户端本地完成，**不上传图片到服务器**
- 仅姿势数值数据（yaw/pitch/roll 等）发送给 AI

## License
MIT
