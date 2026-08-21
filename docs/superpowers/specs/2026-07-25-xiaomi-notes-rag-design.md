# 小米笔记增量 RAG 与阿里云 Embedding 设计

- 日期：2026-07-25
- 状态：已完成对话设计确认，等待书面规格审阅
- 目标：在保留现有 Terra NestJS RAG、安全边界与引用体系的基础上，将小米笔记增量同步到知识库，使用阿里云 Embedding 与本地 LanceDB 提供混合检索。

## 1. 背景

Terra 当前已经具备以下 RAG 能力：

- 加密文档与分块存储
- Markdown 分块及确定性内容哈希
- 未变化分块的本地稀疏向量复用
- BM25 与稀疏向量检索
- 隐私等级过滤
- 敏感信息扫描
- Prompt Injection 扫描与隔离
- 带引用的提取式或外部生成式回答
- 文档删除传播
- 可选 OpenAI-compatible 外部提供方

当前实现尚缺少：

- 小米笔记知识源适配器
- 来源级增量同步账本
- 真正的 Dense Semantic Embedding
- 持久化本地向量索引
- Embedding 设置及同步状态界面
- 向量索引备份、迁移和恢复流程

## 2. 已确认的决策

1. 不以 LangChain 作为核心编排框架。
2. 保留现有 NestJS RAG 领域模型、安全检查、引用和隐私逻辑。
3. 使用原生 TypeScript Provider/Store 接口保持可替换性。
4. 使用阿里云百炼 `text-embedding-v4`，默认 768 维。
5. 使用本地 LanceDB 保存 Dense Vector，不保存正文。
6. `public` 和 `private` 文档允许发送分块到阿里云向量化。
7. `secret` 文档永不发送到阿里云，仅使用本地 BM25/稀疏检索。
8. 查询包含高风险凭证或敏感信息时，不发送 Query Embedding，自动退化为本地检索。
9. 小米笔记列表强制刷新成功后，自动触发后台增量同步。
10. 同步不阻塞小米笔记页面；知识库页面提供状态、手动同步、重试、取消和重建操作。

## 3. 范围

### 3.1 包含

- 小米笔记全分页元数据扫描
- 新增、修改、删除和恢复的增量传播
- 分块级内容哈希复用
- 阿里云 Embedding Provider
- LanceDB Vector Store
- BM25 + Dense Vector 混合检索
- 隐私分流和安全降级
- 设置页面配置
- 知识库同步状态与覆盖率展示
- RAG v1 到 v2 的数据迁移
- 备份与恢复
- 自动化测试及回归验证

### 3.2 不包含

- LangChain/LangGraph Agent 编排
- 阿里云托管知识库
- 将完整笔记托管到外部向量数据库
- 对 `secret` 内容执行云端 Embedding 或外部回答
- 首版 WebSocket/SSE 实时推送
- 首版 Linux 图形化 Secret 写入；Linux 使用环境变量或容器 Secret
- 跨设备实时同步协调

## 4. 总体架构

```text
小米笔记强制刷新成功
          |
          v
XiaomiRagSyncService / Source Adapter
          |
          v
增量同步账本 + 完整扫描 generation
          |
          v
现有规范化 / 隐私扫描 / 注入扫描 / 分块
          |
          +-----------------------------+
          |                             |
          v                             v
本地 BM25/稀疏索引          public/private 分块
                                        |
                                        v
                           AliyunEmbeddingProvider
                                        |
                                        v
                              LanceDbVectorStore
          |                             |
          +-------------+---------------+
                        v
                混合检索与本地重排
                        |
                        v
             加密分块正文、引用与回答
```

权威数据源为加密 RAG 文档、加密同步账本和小米笔记远端内容。LanceDB 是可重建索引，不是唯一真相源。

## 5. 领域模型

### 5.1 文档来源

```ts
export type RagDocumentSource =
  | 'manual'
  | 'file'
  | 'resource'
  | 'xiaomi-note'
```

`RagDocument` 增加：

```ts
sourceItemId?: string
sourceRevision?: string
sourceManaged?: boolean
vectorState?: 'disabled' | 'pending' | 'ready' | 'failed' | 'local-only'
vectorVersion?: string
```

规则：

- 小米笔记标题和正文由来源管理。
- 用户可调整隐私等级、自定义标签及是否排除出知识库。
- 来源文档正文在知识库编辑器中只读。
- 用户标签与自动来源标签分开管理，远端同步不得覆盖用户标签。

### 5.2 同步账本

```ts
interface RagSyncLedgerEntry {
  source: 'xiaomi-note'
  sourceItemId: string
  ragDocumentId: string
  remoteModifyDate: number
  remoteTag?: string
  contentHash: string
  lastSeenGeneration: string
  lastSeenAt: number
  lastIndexedAt?: number
  state: 'active' | 'pending' | 'failed' | 'deleted'
  lastError?: string
  retryCount: number
}
```

同步账本不得保存 Cookie、passToken、serviceToken、API Key 或笔记认证数据。

### 5.3 同步状态

```ts
interface RagSourceSyncStatus {
  source: 'xiaomi-note'
  state: 'idle' | 'scanning' | 'indexing' | 'cancelling' | 'failed'
  startedAt?: number
  finishedAt?: number
  lastSuccessAt?: number
  currentPage?: number
  discovered: number
  processed: number
  created: number
  updated: number
  skipped: number
  deleted: number
  failed: number
  vectorized: number
  localOnly: number
  pendingAfterCurrent: boolean
  error?: string
}
```

### 5.4 Dense Vector

```ts
interface VectorRecord {
  chunkId: string
  documentId: string
  contentHash: string
  embeddingProvider: 'aliyun'
  embeddingModel: string
  embeddingDimensions: number
  embeddingVersion: string
  privacy: RagPrivacy
  injectionRisk: RagRisk
  updatedAt: number
  vector: number[]
}
```

LanceDB 不保存标题、正文、引用文本、用户问题或回答。

## 6. 增量同步

### 6.1 触发

小米笔记首屏强制刷新成功后，前端异步调用：

```http
POST /api/rag/sources/xiaomi/sync
```

后端同步服务自行遍历全部分页，不依赖用户在界面点击“加载更多”。同步 endpoint 应快速返回已入队状态，不等待整个同步完成。

定向操作触发：

- 新建笔记：同步该笔记
- 修改笔记：同步该笔记
- 删除笔记：删除对应 RAG 文档和向量
- 历史恢复：重新同步该笔记
- 查看详情：不触发
- Cookie 续期：不触发

### 6.2 并发与合并

- 同时最多一个小米笔记同步任务。
- 运行中再次请求完整同步时，设置 `pendingAfterCurrent=true`。
- 当前任务结束后最多再运行一次合并后的完整同步。
- 单条笔记更新可以合并到当前任务或进入去重待处理集合。
- Embedding 批次并发为 1，默认每批最多 10 个分块。

### 6.3 增量判定

完整分页扫描首先比较：

- `noteId`
- `modifyDate`
- `tag` 或远端版本标识
- `status`
- 当前 generation 是否见到

行为：

- 新 ID：读取详情、规范化、分块并索引。
- 版本变化：读取详情；仅对内容哈希变化的分块生成新向量。
- 版本未变化：跳过详情和 Embedding。
- 同一分块内容哈希未变化：复用原向量。
- 完整扫描成功后未见的旧记录：执行删除传播。
- 任一分页失败或任务取消：禁止执行缺失删除。

首版不把小米 `syncTag` 当作可永久保存的 delta cursor；它继续用于当前扫描的分页。

### 6.4 generation 与删除安全

每次完整扫描创建唯一 `generationId`。只有当：

1. 所有分页都成功读取；
2. 没有取消；
3. 列表响应结构有效；

才允许将旧 generation 中未出现的活跃记录标记为删除。

删除传播：

1. 移除活跃 RAG 文档和本地分块。
2. 删除该文档的 LanceDB 向量。
3. 留下不含正文的账本 tombstone。
4. 小米历史归档不随之删除。
5. 远端恢复后按同一 `sourceItemId` 恢复映射。

### 6.5 一致性与失败

- 新分块完成本地索引后即可通过 BM25 检索。
- Dense Embedding 失败时，文档状态为 `failed` 或 `pending`，不阻塞本地索引。
- 不保留指向已不存在分块的旧向量。
- LanceDB 写入成功后才提交该分块的向量版本状态。
- 单条失败不阻塞其他笔记。
- 网络或限流错误使用指数退避，最多三次同步内重试，之后进入待重试状态。

## 7. Embedding Provider

### 7.1 接口

```ts
interface EmbeddingProvider {
  getStatus(): EmbeddingProviderStatus
  embedDocuments(documents: EmbeddingDocument[]): Promise<EmbeddingResult[]>
  embedQuery(query: string): Promise<number[]>
}
```

### 7.2 阿里云默认配置

```text
Provider: aliyun
Model: text-embedding-v4
Dimensions: 768
Batch size: 10
Concurrency: 1
Timeout: 20 seconds
Retries: 3 with exponential backoff
```

环境变量：

```env
TERRA_RAG_EMBEDDING_PROVIDER=aliyun
TERRA_RAG_ALIYUN_API_KEY=
TERRA_RAG_ALIYUN_BASE_URL=
TERRA_RAG_ALIYUN_MODEL=text-embedding-v4
TERRA_RAG_ALIYUN_DIMENSIONS=768
TERRA_RAG_ALIYUN_BATCH_SIZE=10
TERRA_RAG_ALIYUN_TIMEOUT_MS=20000
```

API Key 来源优先级：

1. 环境变量
2. Windows DPAPI
3. 未配置

浏览器不得持久化或读取原始 API Key。Linux 首版使用环境变量或部署平台 Secret。

### 7.3 版本隔离

`embeddingVersion` 由以下信息确定：

```text
provider:model:dimensions:normalizationVersion:chunkerVersion
```

模型、维度、规范化版本或分块版本变化时创建新索引命名空间。旧索引在新索引达到可切换条件前继续服务；新索引成功后原子切换。

## 8. 隐私与安全

### 8.1 文档策略

| 隐私 | Document Embedding | 本地 BM25 | 外部生成回答 |
|---|---:|---:|---:|
| public | 允许 | 允许 | 单次授权后允许 |
| private | 允许 | 允许 | 单次授权后允许 |
| secret | 禁止 | 允许 | 禁止 |

`private -> secret` 时删除已有 Dense Vector；`secret -> private` 时加入向量队列。

### 8.2 查询策略

Query Embedding 前运行敏感信息扫描。出现高风险 Cookie、Token、API Key、密码、私钥或类似凭证时：

- 不发送给阿里云。
- 自动退化为本地 BM25/稀疏检索。
- 向用户显示降级原因。
- 不影响本地 secret 文档检索。

### 8.3 日志和凭证

- API 响应仅返回掩码与凭证来源。
- API Key 不进入日志、错误详情、普通备份或客户端状态。
- 同步错误不得包含正文；只记录来源 ID 哈希、错误分类和时间。
- 小米云凭证与 RAG 数据流严格隔离。

## 9. LanceDB Vector Store

### 9.1 接口

```ts
interface VectorStore {
  getStatus(): VectorStoreStatus
  upsert(records: VectorRecord[]): Promise<void>
  search(vector: number[], options: SearchOptions): Promise<VectorMatch[]>
  deleteByChunkIds(ids: string[]): Promise<void>
  deleteByDocumentIds(ids: string[]): Promise<void>
  rebuild(options: RebuildOptions): Promise<void>
}
```

默认位置：

```text
server/data/rag-vectors/
```

可通过 `TERRA_RAG_VECTOR_PATH` 修改。

### 9.2 数据边界

LanceDB 仅保存向量和不含正文的索引元数据。完整分块内容继续从加密 RAG Store 中读取。

向量目录应受操作系统磁盘加密保护。向量库损坏、丢失或版本不兼容时，系统立即退化到 BM25 并后台重建。

### 9.3 低内存要求

- 不将所有 Dense Vector 常驻普通 JavaScript 数组。
- 分页读取小米列表，逐条读取详情。
- Embedding 批次最多 10 条、并发 1。
- 状态和列表 API 不返回向量。
- 初次导入支持取消、继续和失败重试。
- 向量索引是可重建缓存，不能成为正文唯一存储。

## 10. 混合检索

一次查询执行：

1. 本地分词、BM25 和现有稀疏检索。
2. 查询安全检查。
3. 安全且 Provider 可用时生成 Query Embedding。
4. LanceDB Dense Search。
5. 应用隐私、注入风险、文档范围过滤。
6. 使用归一化加权或 Reciprocal Rank Fusion 合并结果。
7. 去重并限制单文档引用数。
8. 从加密 Store 读取引用正文。
9. 生成本地提取式回答或经单次授权调用外部回答模型。

首版目标权重为 BM25 45%、Dense 55%，但实现不得直接混合未归一化原始分数。

降级规则：

| 状态 | 行为 |
|---|---|
| 阿里云和 LanceDB 正常 | 混合检索 |
| 阿里云不可用 | 当前查询退化 BM25；已有文档向量保留 |
| LanceDB 不可用 | BM25 |
| 部分向量待处理 | 已完成内容混合检索，其余 BM25 |
| API Key 未配置 | BM25 |
| 高风险查询 | BM25 |
| secret 文档 | BM25 |

## 11. 设置页面

新增“知识库与语义检索”设置区域：

- Embedding 启用开关
- Provider、Base URL、模型、维度
- API Key 新增/更新/删除
- 凭证来源和掩码
- 测试连接
- 自动同步开关，默认开启
- 小米笔记默认隐私等级，默认 private
- 自动重试开关，默认开启
- 可选每日 Token 预算
- 最后成功/失败时间和错误分类
- 重建语义索引

测试连接只发送固定测试文本，不发送用户笔记。

修改模型或维度时必须明确提示会创建新索引并后台重建，不立即破坏当前可用索引。

## 12. 知识库页面

顶部状态区显示：

- 小米笔记发现数、已同步数、失败数
- Dense Vector 覆盖数量
- 仅本地检索数量
- 当前扫描页、处理进度
- 新增、更新、跳过、删除、失败计数
- 最后成功时间

操作：

- 立即同步
- 重试失败项
- 取消同步
- 重建语义索引
- 查看同步错误
- 打开设置

同步状态首版每 2 秒轮询，不引入 SSE/WebSocket。

小米来源文档正文只读，可修改隐私、自定义标签和知识库排除状态。

## 13. API

```http
GET    /api/rag/status
GET    /api/rag/settings
PATCH  /api/rag/settings

POST   /api/rag/embedding/credentials
DELETE /api/rag/embedding/credentials
POST   /api/rag/embedding/test

POST   /api/rag/sources/xiaomi/sync
GET    /api/rag/sources/xiaomi/status
POST   /api/rag/sources/xiaomi/retry
POST   /api/rag/sources/xiaomi/cancel

POST   /api/rag/vector-index/rebuild
GET    /api/rag/vector-index/status
```

凭证写入和测试接口必须设置严格长度限制、超时和错误脱敏。

## 14. 数据迁移

`RagState.version` 从 1 升级到 2。迁移增加来源字段、Dense 状态、同步账本和 Embedding 版本信息。

要求：

- 原有文档和分块不丢失。
- 原有 BM25 启动后立即可用。
- 现有来源继续为 manual/file/resource。
- Dense 状态初始化为 pending、disabled 或 local-only。
- 启动不等待全量向量化。
- 迁移前生成时间戳恢复副本。
- 迁移失败不覆盖原文件。

## 15. 备份与恢复

备份增加：

```text
加密 RAG State
加密同步账本
rag-vector-manifest.json
rag-vectors/
```

Manifest 记录：

- schema 版本
- Provider、模型、维度
- chunker/normalization 版本
- 当前索引命名空间
- 创建时间和必要校验信息

规则：

- 默认备份向量目录以加快恢复。
- API Key、DPAPI 数据和环境变量不进入普通备份。
- 恢复后向量不兼容时弃用该索引并后台重建。
- 缺少向量时先以 BM25 启动，再后台恢复混合检索。

## 16. 测试

### 16.1 新增测试脚本

```powershell
npm --prefix server run test:rag-xiaomi-sync
npm --prefix server run test:rag-aliyun
npm --prefix server run test:rag-vector-store
npm --prefix server run test:rag-migration
```

测试使用本地 OpenAI-compatible 模拟服务，不使用真实阿里云凭证。

### 16.2 增量同步

- 首次全量同步
- 无变化时不读详情、不调用 Embedding
- 单笔修改只更新变化分块
- 未变化分块复用向量
- 新建、修改、删除、恢复定向传播
- 分页失败和取消时不执行误删
- 并发同步合并
- 单条失败不阻塞其他笔记

### 16.3 隐私

- public/private 调用 Embedding
- secret 不产生外部请求
- private 与 secret 转换时正确创建或删除向量
- 高风险查询不产生外部请求
- 注入高风险片段默认隔离
- API Key 不出现在 API、日志和备份中

### 16.4 检索与降级

- 中文语义近义内容可由 Dense Search 召回
- 精确关键词继续由 BM25 召回
- 混合排序、去重和引用稳定
- 维度不一致拒绝写入
- 新旧模型索引隔离
- 阿里云故障、LanceDB 故障和未配置状态正确降级

### 16.5 迁移和备份

- v1 到 v2 无损迁移
- 迁移失败不覆盖原文件
- 完整恢复可使用向量索引
- 缺失或不兼容向量自动重建
- 凭证不进入备份

### 16.6 回归命令

```powershell
npm --prefix server run typecheck
npm --prefix server run build
npm --prefix server run test:rag-smoke
npm --prefix server run test:rag-external
npm --prefix server run test:rag-load
npm --prefix server run test:xiaomi-boundary
npm --prefix server run test:xiaomi-history
npm run typecheck
npm run build
```

## 17. 验收标准

1. 刷新小米笔记后自动启动后台增量同步。
2. 后端独立遍历完整分页，不依赖前端加载更多。
3. 未变化笔记不重复读取正文或生成向量。
4. 未变化分块复用已有向量。
5. public/private 使用阿里云 Embedding。
6. secret 正文和高风险查询永不发送到阿里云。
7. Dense Vector 保存在本地 LanceDB，正文不写入 LanceDB。
8. 检索采用 BM25 + Dense Vector 混合排序。
9. 阿里云或 LanceDB 故障时仍可本地检索。
10. 小米笔记删除后不再被 RAG 引用。
11. 设置页可安全配置、测试和删除阿里云凭证。
12. 知识库页显示同步进度、错误和向量覆盖率。
13. 原有 RAG v1 数据无损迁移。
14. 备份恢复后可直接使用或自动重建向量。
15. 不在代码、日志、响应或备份中泄漏真实凭证。
16. 新增和现有测试全部通过。

## 18. 实施约束

- 不回退或覆盖工作区内与本功能无关的未提交修改。
- 不提交 HAR、`passtoken_refresh/myinfo.txt` 或任何真实凭证。
- `.git` 若不可写，则完成代码和验证后由用户提交。
- 新依赖必须锁定到兼容 Node.js 22 和当前 TypeScript/NestJS 版本的版本。
- LanceDB 初始化失败不能阻止服务器启动；RAG 必须可退化到本地模式。
- 所有新错误信息必须脱敏且使用可理解的中文界面文案。
