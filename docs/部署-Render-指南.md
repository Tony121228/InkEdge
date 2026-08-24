# 部署到 Render 指南

本文档说明如何将本项目通过 Render 持续部署为一个在线服务。

## 前置准备
- 需要一个 GitHub 公共仓库（Public）。
- 需要一个 Render 账号（可使用 GitHub 登录）。

## 一、在 GitHub 创建空仓库
1. 登录 GitHub，创建一个 Public 仓库（不要勾选初始化 README/License）。
2. 复制仓库的 HTTPS 地址，形如
   https://github.com/<your-account>/<repo>.git。

## 二、把本地项目推送到新仓库
> 由代理在本地配置远程后执行推送，不在此列出命令。

## 三、在 Render 连接仓库并部署
1. 打开 Render Dashboard → New → Web Service。
2. 选择 GitHub 仓库（选择上一步的新仓库）。
3. 基本设置：
   - Environment: Node
   - Build Command: npm install
   - Start Command: npm start
   - Health Check Path: /health
4. 环境变量（Environment）：根据 `.env.example` 设置必要项（以下仅为占位，与敏感信息无关）：
   - APP_SECRET
   - AI_API_BASE_URL（可选）
   - AI_API_KEY（没有则检测/改写功能不可用）
   - AI_DETECT_MODEL / AI_REWRITE_MODEL（可选）
   - SMTP_*（如需邮件功能）
5. 创建后等待构建完成，即可访问 Render 提供的 URL。

## 四、健康检查
- 成功启动后，访问 /health 应返回 200。

## 备注
- 仓库已添加 render.yaml（蓝图部署文件），也可在 Render 使用 Blueprint 方式创建服务。

---
**置信度：0.86**（本指南基于本项目现有脚本与 Render 官方惯例，细节以当时平台 UI 为准）。