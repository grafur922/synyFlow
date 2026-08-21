# Terra Hub

Terra Hub 是一个本地优先的个人聚合系统，基于 Vue 3、Pinia、Tauri v2 构建，并配有 NestJS 伴生 API。

## 现有模块

- **待办事项**：本地优先的任务管理，可选 NestJS 同步，支持 SSE 更新。
- **小米笔记**：服务端连接器，可列出、读取、创建、编辑和软删除用户自己小米云账号中的笔记。桌面工作区包含可调整大小/可折叠的主侧边栏和次侧边栏、打开的文档标签页、H1/H2 大纲标签页、可查询的行级加密 SQLite 历史记录、基于快照的笔记重建、小米文件夹过滤、只读模式、故障熔断、有证据支撑的 Passport 自动续期以及脱敏审计事件。
- **全局搜索**：加密的统一资源索引，带持久化的小米增量游标、周期性全量扫描的删除检测、冲突版本审阅/解决、源墓碑、规范化项目/时间/位置上下文、隐私/类型/来源/上下文组合过滤、相关性评分、摘要和来源导航。
- **RSS 阅读器**：加密的 RSS/Atom 订阅、安全的防 SSRF 抓取、条件刷新、未读/收藏状态、调度以及资源搜索集成。
- **博客编辑器**：加密的 Markdown 草稿、小米笔记导入、隐私扫描、沙箱化预览、原子化的静态站点发布/更新/撤下，以及资源索引。
- **旅行规划器**：加密的行程、天/地点时间线、供应商地图链接、行级加密附件、口令保护的离线打包、交通、预订、多币种预算、清单、导出、校验、资源索引，以及从收藏的 RSS/小米资源导入的隐私感知候选收件箱。
- **知识库**：加密的 RAG v2 文档、增量小米笔记摄取、本地 BM25/稀疏检索，可选阿里云 `text-embedding-v4` + LanceDB 混合检索、严格的机密/高风险隐私路由、提示注入隔离、带引用的回答、来源管理的编辑与删除传播。
- **设置 / 备份**：浏览器本地的待办/UI 加密备份与恢复，以及离线的服务端加密备份/检查/原子恢复工具。
- **日历 / 洞察**：与聚合工作区一并保留。

旧路由 `/dashboard` 和 `/tasks` 现在重定向到规范路由 `/todo`。在移动端，小米笔记是底部导航的第二项。

## 安全模型

小米云凭证只能存在于 NestJS 进程中：

- 使用服务端环境变量或当前用户的 Windows DPAPI 文件；当未配置环境 Cookie 时，小米笔记页面可以通过仅本地的后端端点安全地保存完整 Cookie；
- 保留 macOS Keychain 辅助代码以供后续平台验证，但 macOS 和 Android 的凭证存储暂缓，不属于当前发布承诺；
- 切勿将 Cookie 放入 `VITE_*`、Vue 代码、localStorage、截图或 Git 中；
- 抓取的请求/响应目录已被 `.gitignore` 排除，因为它们包含实时会话令牌和私有笔记文本；
- 连接器调用固定的 `https://i.mi.com` 源，应用请求超时和校验，且不记录请求体或凭证。

API 默认绑定到 `127.0.0.1`。除非明确启用并受至少 32 字符的 API 令牌保护，否则拒绝远程绑定。全局搜索和 RAG 默认排除机密内容。机密 RAG 文档永不离开服务器；阿里云 Embedding 凭证仅作为服务端环境/Windows DPAPI 值存在，且被排除在备份之外。

用于推导此连接器的数据包抓取包含一个可复用的 `serviceToken`。如果该抓取内容已分享或备份到受信任的加密位置之外，请在开发后撤销/更新该小米会话。

## 开发

前端：

```powershell
npm install
npm run dev
```

后端：

加密 SQLite 历史后端需要 Node.js 22.12 或更高版本。

```powershell
Copy-Item server/.env.example server/.env
# 可选：将 XIAOMI_CLOUD_COOKIE 设置为完整的 Cookie 请求头。
# 在 Windows 上，也可以在小米笔记页面安全输入。
npm run dev:server
```

前端 API 源（根目录 `.env.local`）：

```env
VITE_TERRA_API_URL=http://localhost:3001
```

## 验证

```powershell
npm run build
npm run typecheck:server
npm run build:server
npm --prefix server run test:travel-smoke
npm --prefix server run test:rag-smoke
npm --prefix server run test:rag-external
npm --prefix server run test:rag-aliyun
npm --prefix server run test:rag-vector-store
npm --prefix server run test:rag-hybrid
npm --prefix server run test:rag-xiaomi-sync
npm --prefix server run test:rag-migration
npm --prefix server run test:access-smoke
npm --prefix server run test:backup-smoke
npm --prefix server run test:secrets-smoke
npm --prefix server run test:xiaomi-credentials
npm --prefix server run test:xiaomi-passport
npm --prefix server run test:xiaomi-refresh
npm --prefix server run test:rag-load
npm --prefix server run test:xiaomi-boundary
npm --prefix server run test:resource-sync
npm --prefix server run test:xiaomi-history
```

有关分阶段的产品待办清单，请参阅 `docs/AGGREGATION_ROADMAP.md`；关于有证据支撑的小米能力边界，请参阅 `docs/XIAOMI_CAPTURE_EVIDENCE.md`；关于备份/凭证操作，请参阅 `docs/BACKUP_SECURITY.md`；API 详情请参阅 `server/API.md`。