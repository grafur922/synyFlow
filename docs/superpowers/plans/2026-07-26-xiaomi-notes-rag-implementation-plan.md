# 小米笔记增量 RAG 实施计划

- 日期：2026-07-26
- 规格：`docs/superpowers/specs/2026-07-25-xiaomi-notes-rag-design.md`
- 状态：已确认，待实施

## 原则

- 保留现有 RAG 的加密正文、BM25、隐私、注入隔离、引用和外部回答流程。
- 不引入 LangChain；使用小型原生 Provider/Store 接口。
- 不修改或回退工作区中与本功能无关的已有变更。
- 不将任何真实小米或阿里云凭证写入代码、日志、测试固件或备份。
- LanceDB 失败必须降级为现有本地 BM25，不阻止服务启动。

## 阶段 0：基线与依赖

1. 记录现有工作区状态及 RAG/Xiaomi 回归测试基线。
2. 确认 Node.js 22 兼容的 LanceDB Node/TypeScript 依赖，添加到 `server/package.json` 和锁文件。
3. 增加受控的配置常量、路径和依赖初始化；不在模块加载阶段进行网络请求。
4. 验证 `npm --prefix server run typecheck` 与 `npm --prefix server run build`。

## 阶段 1：RAG v2 数据模型与迁移

涉及文件：

- `server/src/rag/rag.model.ts`
- `server/src/rag/rag.service.ts`
- `src/shared/rag.ts`
- `server/src/rag/dto/*`

步骤：

1. 将 `RagDocumentSource` 扩展为 `xiaomi-note`。
2. 为来源托管文档增加 `sourceItemId`、`sourceRevision`、`sourceManaged`、`vectorState`、`vectorVersion` 字段。
3. 增加同步账本、同步状态、Embedding 设置和 Vector Store 状态模型。
4. 将持久化状态升级为 RAG v2，并实现严格验证、v1 读取与有界迁移。
5. 迁移前通过底层存储创建恢复副本；迁移失败不得覆盖原数据。
6. 令历史 document/chunk 数据立即保持 BM25 可查，不强制首次启动向量化。
7. 更新状态、文档列表、文档详情 API 与客户端共享类型。

验证：v1 fixture 迁移、无损读取、非法字段拒绝、旧 RAG smoke 继续通过。

## 阶段 2：Embedding 凭证和 Provider

涉及文件：

- `server/src/security/secrets.ts`
- `server/src/rag/aliyun-embedding.provider.ts`（新增）
- `server/src/rag/rag-embedding-settings.service.ts`（新增或并入 RAG service）
- `server/src/rag/dto/*`（新增）
- `server/src/rag/rag.controller.ts`
- `server/.env.example`
- `server/API.md`

步骤：

1. 增加环境变量优先、Windows DPAPI 次之的阿里云 API Key 读取/写入/删除能力；响应只返回掩码与来源。
2. 实现 `EmbeddingProvider` 接口和 OpenAI-compatible 阿里云请求客户端。
3. 强制模型、维度、批大小、超时、响应大小和重试边界；默认 `text-embedding-v4`/768/10/20 秒。
4. 用固定测试字符串实现连接测试，避免测试接口发送用户笔记。
5. 对错误、日志和异常实施正文/Key 脱敏。
6. 增加配置状态、凭证更新/删除/测试 API。

验证：本地 mock server 覆盖成功、超时、429、非法维度、无凭证、DPAPI 掩码和不泄露 Key。

## 阶段 3：LanceDB Vector Store 与向量版本

涉及文件：

- `server/src/rag/vector-store.ts`（新增接口）
- `server/src/rag/lancedb-vector.store.ts`（新增）
- `server/src/rag/rag.service.ts`
- `server/src/rag/rag-indexer.ts`

步骤：

1. 初始化本地 LanceDB 目录，路径由 `TERRA_RAG_VECTOR_PATH` 控制。
2. 创建仅含 vector 与无正文元数据的表结构。
3. 实现按 chunk/document 的 upsert、查询、删除、状态与错误降级。
4. 用 `provider:model:dimensions:normalization:chunker` 隔离索引版本。
5. 模型/维度变化时新建索引命名空间；完成后原子切换。
6. 所有 Dense Vector 写入/删除与加密 RAG state 的更新保持不产生悬挂引用。
7. 故障、损坏或不兼容时标记向量库不可用并退回 BM25。

验证：schema、批量 upsert、过滤、删除、维度拒绝、命名空间切换、目录丢失/故障降级。

## 阶段 4：混合检索与隐私分流

涉及文件：

- `server/src/rag/rag.service.ts`
- `server/src/rag/local-embedding.provider.ts`
- `server/src/rag/prompt-injection-scanner.ts`
- `server/src/rag/rag.model.ts`
- `src/shared/rag.ts`
- `src/views/KnowledgeBase.vue`

步骤：

1. 保持当前 BM25 稀疏召回为本地基线。
2. 对 public/private 且未被高风险注入隔离的分块入队 Dense Embedding。
3. secret 文档禁止 Document Embedding 和 LanceDB 写入，但保留 BM25。
4. Query 先做隐私扫描；高风险查询仅执行 BM25。
5. 正常 Query 执行 Dense Search，按隐私/风险过滤，然后和 BM25 通过归一化/RRF 合并。
6. 保留现有去重、每文档限制、引用、置信度及 external answer 规则。
7. 在返回状态中标注混合/本地/降级原因，清理 query cache 的版本键。

验证：中文语义召回、精确词召回、secret 无远程请求、敏感查询无远程请求、Provider 或 Store 故障降级、无过期向量引用。

## 阶段 5：小米笔记 Source Adapter 和增量同步

涉及文件：

- `server/src/rag/xiaomi-notes-rag-sync.service.ts`（新增）
- `server/src/rag/rag.service.ts`
- `server/src/rag/rag.controller.ts`
- `server/src/xiaomi-notes/xiaomi-notes.service.ts`
- `server/src/xiaomi-notes/xiaomi-notes.controller.ts`（仅必要时）
- `src/store/xiaomiNotes.ts`
- `src/services/ragApi.ts`

步骤：

1. 使用 XiaomiNotesService 的分页和详情 API 实现服务端全分页扫描；不依赖前端加载更多。
2. 生成 scan generation，并与 ledger 比较 `id`、`modifyDate`、`tag`、content hash。
3. 仅取回新建或修改笔记的详情；仅对变化分块生成 Dense Vector。
4. 扫描完整成功后才处理缺失笔记删除；失败、取消或坏响应时禁止删除。
5. 实现单运行任务、合并的 `pendingAfterCurrent`、协作取消、单条重试和错误计数。
6. 将创建、更新、删除、恢复等本地小米操作提交为定向同步提示。
7. 首屏强制刷新成功后，前端异步入队完整同步，不影响笔记 UI 成功状态。

验证：首次导入、无变化跳过、单笔变更、分块复用、删除、部分扫描失败不误删、取消、队列合并、恢复和不泄露远端凭证。

## 阶段 6：设置与知识库界面

涉及文件：

- `src/views/Settings.vue`
- `src/views/KnowledgeBase.vue`
- `src/services/ragApi.ts`
- `src/shared/rag.ts`
- 可选 `src/store/*`（如状态需要独立存储）

步骤：

1. 在设置页增加“知识库与语义检索”区域：配置、凭证掩码、测试、删除、自动同步、预算和重建提示。
2. 在知识库顶部增加来源同步状态、向量覆盖率、错误和操作按钮。
3. 每 2 秒轮询运行中的同步状态，组件卸载时清理定时器。
4. 小米来源文档显示来源/索引状态，正文只读，隐私和用户标签仍可编辑。
5. 显示阿里云不可用、BM25 降级、敏感查询拦截和索引待处理的可理解中文文案。
6. 验证无 API Key 落入前端持久化、控制台或 UI 状态。

验证：前端 typecheck/build，手动状态流、禁用态、错误态和移动端布局检查。

## 阶段 7：备份、文档与自动化验收

涉及文件：

- `server/scripts/terra-backup.cjs`
- `server/scripts/*rag*.cjs`（新增/扩展）
- `server/README.md`
- `server/API.md`
- `README.md`
- `server/.env.example`

步骤：

1. 将 vector manifest 和 LanceDB 目录安全纳入服务端备份；Key/DPAPI/环境变量一律排除。
2. 恢复时校验 manifest；缺失或不兼容时保留文档并安排重建。
3. 新增 Xiaomi sync、Aliyun mock、Vector Store、迁移测试脚本。
4. 记录环境变量、部署要求、隐私边界、恢复和故障降级说明。
5. 运行新脚本以及现有 RAG/Xiaomi/backup/typecheck/build 回归。
6. 进行最终需求逐项审计，检查源代码、日志 fixture 和 git diff 中不存在真实凭证。

## 交付顺序与检查点

1. 阶段 1–2 后：数据与 Provider 可配置但不改变现有检索结果。
2. 阶段 3–4 后：手工文档可进行本地 Hybrid RAG，故障可降级。
3. 阶段 5 后：小米笔记端到端自动增量同步。
4. 阶段 6 后：用户可完成配置、查看、重试和控制。
5. 阶段 7 后：具备备份、恢复、文档和回归证据。

## 最终验收证据

- 所有新增自动化测试与已有回归脚本通过。
- `npm --prefix server run typecheck` 与 `npm --prefix server run build` 通过。
- `npm run build` 通过。
- 代码审计证明 secret 文档和敏感 Query 不发送给阿里云。
- 代码审计证明 LanceDB 不写入正文，备份不写入 API Key/DPAPI。
- 端到端 mock 证明刷新小米笔记自动入队、增量跳过及删除安全。
