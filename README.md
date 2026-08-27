# Terra Hub

Terra Hub 是一个本地优先的个人聚合工作区，基于 Vue 3、Tauri v2 与 NestJS 构建。集成待办事项、小米笔记、知识库 (RAG)、RSS 阅读器、旅行规划、博客与 AI 智能体等模块。

---

## 环境要求

- Node.js: `>= 22.12.0`
- 包管理器: `npm`
- 操作系统: Windows / macOS / Linux (移动端支持 Android via Tauri)

---

## 快速启动

### 1. 安装依赖

```bash
# 安装前端依赖
npm install

# 安装后端依赖
npm --prefix server install
```

### 2. 配置环境变量

复制后端环境配置文件并按需修改：

```bash
# Windows PowerShell
Copy-Item server/.env.example server/.env

# Linux / macOS
cp server/.env.example server/.env
```

前端默认 API 地址为 `http://localhost:3001`，如需自定义可在根目录创建 `.env.local`：

```env
VITE_TERRA_API_URL=http://localhost:3001
```

### 3. 启动开发服务

```bash
# 启动前端开发服务器 (默认端口 http://localhost:1420)
npm run dev

# 启动后端 NestJS 开发服务 (默认端口 http://localhost:3001)
npm run dev:server
```

---

## 打包与构建

```bash
# 前端类型检查与打包
npm run build

# 后端构建
npm run build:server

# 本地预览前端产物
npm run preview
```

---

## 移动端 / Tauri (可选)

```bash
# 端口反向代理 (Android 调试)
npm run android:reverse

# 启动 Android 调试
npm run android:dev
```

---

## 测试与验证

```bash
# 后端类型检查
npm run typecheck:server

# 运行主要冒烟测试 (RAG / 知识库 / 小米笔记 / 同步)
npm --prefix server run test:rag-smoke
npm --prefix server run test:rag-hybrid
npm --prefix server run test:travel-smoke
npm --prefix server run test:backup-smoke
```