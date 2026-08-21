# Terra LLM、Hybrid Search、MCP 与 Hermes 实施计划

- 日期：2026-08-21
- 规格：`docs/superpowers/specs/2026-08-15-llm-hybrid-mcp-hermes-design.md`
- 状态：已获用户批准，待实施
- 目标：在当前模块化单体 Terra 中逐步落地 LLM Gateway、增强型 Hybrid Search、事实/证据模型、远程 MCP、Hermes 身份信任链、三种执行模式、Approval Broker、任务 Worker、审计和一致性保护。

## 实施原则

- 先补基础契约和安全边界，再接入 LLM、MCP 和 Hermes；不先搭空壳 MCP。
- 保留当前已完成的小米同步、加密 RAG 状态、BM25、阿里云 Embedding、LanceDB 和现有降级行为。
- SQLite 作为核心事实状态源；LanceDB、BM25 派生索引和 LLM 结果均必须可重建或可标记失效。
- 所有跨模块请求携带 Trace Context；Trace ID 不参与权限、审批或幂等判断。
- 不把真实 Cookie、Token、API Key、HAR、DPAPI 明文写入代码、日志、测试 fixture、备份或 Git。
- 不引入 LangChain、Neo4j、Redis、RabbitMQ 或独立工作流平台；Provider、Worker、Search 和 MCP 使用本地小型接口。
- 每个阶段结束后运行针对性测试，再进入下一阶段；不跨阶段大范围修改。

## 阶段 0：基线、分支边界与基础配置

### 目标

在不改变现有业务行为的前提下建立可回滚基线，并确认新增模块的目录、配置和数据迁移入口。

### 主要文件

- `server/src/app.module.ts`
- `server/src/main.ts`
- `server/.env.example`
- `server/src/config/*`（新增或沿用现有配置方式）
- `server/src/storage/*`
- `server/scripts/*`
- `docs/` 中部署与回滚说明

### 步骤

1. 记录当前 Git 状态、现有 RAG/Xiaomi smoke、typecheck、build 基线；不清理用户现有未提交变更。
2. 统一新增配置命名：MCP、Hermes Service Token、公钥、User Assertion、Task Worker、Trace、索引安全和执行模式。
3. 所有配置读取集中化，启动时校验格式和边界，禁止把明文凭证写入普通配置状态响应。
4. 增加模块级 feature flags，默认不改变现有 API 行为；新 MCP 和 LLM 写操作默认关闭或只读。
5. 约定 SQLite migration/version 入口，后续表结构变更可重复执行。

### 验证

- `npm --prefix server run typecheck`
- `npm --prefix server run build`
- 现有 RAG/Xiaomi/backup smoke 全部通过。
- 启动日志不出现任何 Token、Cookie、Key 或正文。

## 阶段 1：Trace Context、错误模型与审计基础

### 目标

先建立跨 HTTP、MCP、内部 Service、LLM、Worker、Approval 的统一关联能力。

### 主要文件

- `server/src/observability/trace-context.ts`（新增）
- `server/src/observability/request-context.middleware.ts`（新增）
- `server/src/observability/audit.service.ts`（新增）
- `server/src/observability/metrics.service.ts`（新增）
- `server/src/observability/*.model.ts`（新增）
- `server/src/app.module.ts`
- `server/src/main.ts`
- `server/src/*/*.controller.ts`

### 步骤

1. 定义 `trace_id`、`span_id`、`request_id`、`operation_id`、`job_id`、`approval_id` 和 `idempotency_key` 的类型与生成规则。
2. HTTP 请求入口生成或校验 Trace Context；无效外部 Trace ID 重新生成，并把外部值只作为非授权的 upstream 标识。
3. 为 MCP 请求建立相同 Request Context；将上下文显式传入 Service、Provider 和 Worker，而不是依赖不可控全局变量。
4. 定义脱敏结构化日志：只记录 hash、数量、耗时、模型、状态和错误码，不记录正文、完整 Query、Prompt 或凭证。
5. 建立 `audit_events` 表/存储，并让权限检查、搜索、LLM、审批、任务、同步和失败降级写入审计事件。
6. 暴露 `/health`、`/ready`、`/metrics`，不返回数据内容和凭证状态细节。

### 验证

- 同一个逻辑请求的 MCP → Search → LLM 日志共享 `trace_id`。
- 重试请求有不同 `request_id`，但可保持同一个 `operation_id` / 幂等键。
- 日志 fixture 中不存在 Cookie、Token、正文和 API Key。
- Trace ID 不能改变权限判断。

## 阶段 2：SQLite 核心表与数据迁移框架

### 目标

建立 P0/P1 所需的持久化状态，避免继续把长任务、审批和派生事实只放在内存或单个 JSON 文件中。

### 主要文件

- `server/src/storage/sqlite/*`（新增）
- `server/src/storage/sqlite/schema.ts`（新增）
- `server/src/storage/sqlite/migrations/*`（新增）
- `server/src/storage/sqlite/repository.ts`（新增）
- `server/src/rag/rag.model.ts`
- `server/src/rag/rag.service.ts`
- `server/src/storage/encrypted-json.store.ts`
- `server/src/app.module.ts`

### 表与索引

首版至少建立：

```text
schema_migrations
llm_tasks
operations
approvals
audit_events
request_grants
identity_mappings
entity_records
entity_mentions
relation_records
relation_mentions
structured_facts
index_manifests
evidence_records
rerank_cache
```

敏感 payload 使用应用层加密或最小化存储；凭证仍通过现有 Secrets/DPAPI 边界管理，不直接进入这些表。

### 步骤

1. 实现迁移版本、事务封装、busy timeout 和单进程 SQLite 访问约束。
2. 为任务、操作、审批、Grant、身份映射和审计建立主键、状态字段、Hash 字段和时间索引。
3. 为实体、关系、事实、Revision、Index 和 Evidence 预留 `content_hash` / `revision_id` / `privacy_class`。
4. 为重复任务、重复写操作和重复审批建立唯一约束或等价幂等保护。
5. 为现有 RAG JSON 状态建立只读兼容/迁移策略；迁移失败不能覆盖原文件。

### 验证

- 空数据库可从零迁移。
- 重复执行 migration 不改变结果。
- 事务失败回滚完整。
- SQLite 文件与数据库备份路径不包含明文密钥。

## 阶段 3：Hermes Service Identity、User Assertion 与 Grant

### 目标

落地 P0 身份信任链，在开放 MCP Endpoint 之前先完成调用者认证和用户映射。

### 主要文件

- `server/src/identity/identity.service.ts`（新增）
- `server/src/identity/hermes-token.service.ts`（新增）
- `server/src/identity/user-assertion.service.ts`（新增）
- `server/src/identity/identity-guard.ts`（新增）
- `server/src/identity/grant.service.ts`（新增）
- `server/src/identity/identity.model.ts`（新增）
- `server/src/security/secrets.ts`
- `server/.env.example`
- `server/API.md`

### 步骤

1. 实现 Hermes Service Token 的 hash、撤销、过期和允许范围检查。
2. 实现 User Assertion v1：优先 Ed25519；包含 issuer、agent、channel、`channel_user_id`、session、iat、exp、nonce 和断言版本。
3. 固定 `channel_user_id` 来源为 Hermes 已验证的飞书事件字段；拒绝来自普通 Header、消息正文或自由生成的 owner ID。
4. 实现 `(channel, channel_user_id) -> owner_id` 服务端映射；单用户默认只允许配置的飞书用户。
5. 实现 Grant 模型：工具、来源、项目、最大隐私等级、风险、写入、批量、模式和过期时间。
6. 编写统一身份上下文，把身份、Session、Grant 和 Trace Context 传入后续业务层。
7. 未认证、断言过期、nonce 重放、用户未映射、agent/channel 不匹配时统一拒绝。

### 验证

- 合法 Service Token + 合法 Assertion 成功。
- 伪造或篡改 Header 不提升权限。
- 断言过期、重放、错误签名和未映射用户失败。
- Service Token 撤销立即生效。
- 单用户绑定不会接受其他 Feishu 用户。

## 阶段 4：Index Security、Revision / Index / Evidence 状态模型

### 目标

把 P0 索引安全边界和 P1 一致性规则落到现有 RAG/LanceDB 数据结构。

### 主要文件

- `server/src/rag/rag.model.ts`
- `server/src/rag/rag.service.ts`
- `server/src/rag/rag-indexer.ts`
- `server/src/rag/lancedb-vector.store.ts`
- `server/src/rag/vector-store.ts`
- `server/src/rag/index-consistency.service.ts`（新增）
- `server/src/rag/evidence.service.ts`（新增）
- `server/src/storage/encrypted-json.store.ts`
- `server/scripts/backup-smoke.cjs`
- `server/scripts/rag-consistency-smoke.cjs`（新增）

### 步骤

1. 明确 Revision、Index、Evidence 状态和所有派生记录的 `revision_id`、`content_hash`、`index_version`、`privacy_class`。
2. 保持 BM25 terms 只在加密 RAG 状态或受保护存储中；禁止生成明文独立倒排文件。
3. 确保 LanceDB 只写向量和最小元数据，不写正文、标题、Snippet、完整事实和凭证。
4. 将 `secret` 从远程 Embedding、远程 Rerank、远程 Answer 和默认持久化 LanceDB 路径排除；若支持本地 Secret 搜索，使用临时本地路径并清理。
5. 增加 SQLite Outbox / index manifest / Tombstone，让 SQLite 状态和 LanceDB 最终一致。
6. 实现启动和手动触发的一致性扫描：Revision、Chunk、Embedding、Entity、Relation、Evidence 和删除状态。
7. Answer 前重新验证 Evidence 的 Revision 和 Content Hash；失效时重新检索或降级。
8. 更新备份：索引和数据库加密或位于受保护数据卷，解密密钥始终独立。

### 验证

- LanceDB 文件中不存在正文和凭证字段。
- Secret 文档不会写入持久化向量库。
- 内容更新后旧索引标记 stale，Evidence 不会静默引用新状态。
- 删除、恢复、部分索引失败和重启后扫描均可修复。
- backup smoke 验证密钥不进入归档。

## 阶段 5：SQLite Task Queue Lease / Heartbeat / Worker

### 目标

把异步 LLM、Embedding、索引和摘要任务从简单 Promise/内存队列升级为可恢复 Worker。

### 主要文件

- `server/src/tasks/task.model.ts`（新增）
- `server/src/tasks/task.repository.ts`（新增）
- `server/src/tasks/task-queue.service.ts`（新增）
- `server/src/tasks/task-worker.service.ts`（新增）
- `server/src/tasks/task-handler.registry.ts`（新增）
- `server/src/tasks/task-retry.policy.ts`（新增）
- `server/src/app.module.ts`
- `server/src/rag/*`

### 步骤

1. 实现 `pending/running/retry_waiting/succeeded/failed/cancelled` 状态与 `available_at`。
2. 使用 `BEGIN IMMEDIATE` 或等价事务领取任务，写入 `lease_owner`、`lease_expires_at` 和 `heartbeat_at`。
3. Worker 定时 Heartbeat；Lease 过期后可被其他 Worker 重新领取。
4. 进程启动恢复过期 Lease，按 attempt、max_attempts 和指数退避处理。
5. 使用注册式 Handler 执行 Embedding、摘要、实体、关系、事实和索引任务；Handler 必须幂等。
6. 每个任务传递 Trace Context；错误只写脱敏 code/message。
7. 增加优先级和资源压力暂停：用户请求优先，后台并发默认 1。
8. 支持取消、单任务重试、批量重建和任务状态查询。

### 验证

- Worker 崩溃后任务可恢复。
- Heartbeat 延长 Lease；失联 Worker 不会永久占用任务。
- 两个 Worker 不会同时领取同一有效 Lease。
- 相同 idempotency key 不产生重复派生记录。
- 服务器内存压力时后台暂停，基础搜索不受影响。

## 阶段 6：LLM Gateway、Schema、隐私路由与 Provider

### 目标

建立统一 LLM 边界，再将具体任务接入队列或同步查询。

### 主要文件

- `server/src/llm/llm.gateway.ts`（新增）
- `server/src/llm/llm.model.ts`（新增）
- `server/src/llm/llm-provider.registry.ts`（新增）
- `server/src/llm/remote-provider.adapter.ts`（新增）
- `server/src/llm/local-provider.adapter.ts`（新增）
- `server/src/llm/privacy-router.ts`（新增）
- `server/src/llm/sensitive-input.guard.ts`（新增）
- `server/src/llm/schema-validator.ts`（新增）
- `server/src/llm/prompt-registry.ts`（新增）
- `server/src/rag/aliyun-embedding.provider.ts`
- `server/.env.example`
- `server/API.md`

### 步骤

1. 定义 `generate`、`embed`、`rerank` 和 `health` 接口及 Provider registry。
2. 将现有阿里云 Embedding Provider 适配到 Gateway；保留模型、维度和超时校验。
3. 实现 `public/private/secret` 路由，凭证模式、完整 HAR、Cookie、Token、私钥和 DPAPI 明文无条件拒绝远程。
4. 实现文本检测、字段检测、高熵检测、输入裁剪和脱敏；错误和日志不保存原文。
5. 实现 JSON Schema、数量/长度/Span/Confidence/类型校验；失败最多执行一次结构化修复。
6. 注册实体、关系、事实、结构化、摘要、Query Understanding、Answer 和 Rerank 任务策略。
7. 固定 Prompt/model 版本并写入 LLM 审计；模型失败返回可识别的降级结果。
8. 默认禁用远程 Answer 直到 Evidence 验证链就绪；Secret 仅本地/规则处理。

### 验证

- Provider 切换不影响业务 Service 接口。
- Secret、Cookie、Token、HAR 不出远程请求。
- 非法 JSON、非法 Span、超量实体和无效 confidence 被拒绝。
- 超时、429、Schema 失败和无 Provider 时均可降级。
- LLM 调用审计包含 trace、model、prompt version、latency 和状态。

## 阶段 7：实体、关系、事实与摘要增强

### 目标

将笔记内容增量地变成可审计的实体、关系和结构化事实；保持人工确认优先。

### 主要文件

- `server/src/entity/entity.service.ts`（新增）
- `server/src/entity/entity.model.ts`（新增）
- `server/src/entity/entity-merge.service.ts`（新增）
- `server/src/entity/fact.service.ts`（新增）
- `server/src/entity/relation.service.ts`（新增）
- `server/src/rag/xiaomi-notes-rag-sync.service.ts`
- `server/src/tasks/task-handler.registry.ts`
- `server/src/rag/evidence.service.ts`
- `src/views/KnowledgeBase.vue`（后续显示）

### 步骤

1. 创建候选实体、Mention、关系、Relation Mention 和 Structured Fact 记录。
2. 强制绑定来源文档、Revision、Chunk、Span、抽取运行、模型和 Prompt 版本。
3. 实现 canonical entity 去重的保守策略；低置信度只做 candidate，不自动合并人工确认实体。
4. 实现事实状态、有效时间、当前标记、冲突保留和用户确认覆盖。
5. 新模型结果不能覆盖 `confirmed`、`rejected` 或人工隐藏记录；冲突候选标记 `uncertain` / `contradicted`。
6. 增加按实体、事实、关系和状态的结构化查询接口。
7. 摘要作为可重建派生数据，必须带来源版本和生成版本。

### 验证

- 抽取结果都有有效 Span。
- 人工确认结果不会被重跑覆盖。
- 相悖事实并列保存；无冲突时不额外制造历史结果。
- 删除文档后来源证据和派生数据按生命周期处理。

## 阶段 8：Hybrid Search、RRF、Query Compiler 与 Rerank

### 目标

把现有搜索升级为可解释的多路召回，并实现 P1 Rank Fusion / Score Normalization；普通搜索不强制 Rerank。

### 主要文件

- `server/src/search/query-plan.model.ts`（新增）
- `server/src/search/query-compiler.service.ts`（新增）
- `server/src/search/hybrid-search.service.ts`（新增）
- `server/src/search/rank-fusion.ts`（新增）
- `server/src/search/rerank.service.ts`（新增）
- `server/src/search/search.model.ts`（新增）
- `server/src/rag/rag.service.ts`
- `server/src/rag/lancedb-vector.store.ts`
- `server/src/rag/evidence.service.ts`
- `server/src/llm/*`

### 步骤

1. 先由本地规则生成 QueryPlan；复杂查询再调用 Query Understanding Gateway。
2. 对 intent、时间、来源、状态、实体类型、关系谓词、limit、privacy 和 rerank mode 做白名单校验。
3. 并行执行 BM25、Dense、结构化、实体/关系召回；硬过滤在融合前执行。
4. 实现 Weighted RRF：`rrf_k=60`，默认关键词 1.00、向量 1.00、结构化 1.20、实体关系 1.10。
5. 实现 p10/p90 分数归一化、候选过少时的 rank 归一化、exact/entity/freshness boost 和稳定 Tie-break。
6. 保留每个结果的召回路径、原始排名、RRF 分数、归一化分数和索引版本。
7. 实现 `off/auto/required` Rerank；只对 Top 20～50 候选调用专用 Reranker Provider。
8. Rerank 失败回退本地排序；缓存只保存候选 ID、分数、模型版本和 TTL。
9. 生成 Evidence Pack，并在交给 Answer 前执行 Revision、权限、Content Hash 和敏感数据验证。

### 验证

- BM25 / Dense / 结构化任一路径不可用时仍可工作并发出降级警告。
- BM25 与向量分数不直接相加。
- 硬过滤结果不会被语义分数补回。
- 普通搜索不触发 Rerank；复杂问答按条件触发。
- 排序在相同输入下可复现。

## 阶段 9：Answer Engine 与 Claim → Evidence 验证

### 目标

只允许最终回答引用当前授权且版本有效的 Evidence Pack。

### 主要文件

- `server/src/answer/answer.service.ts`（新增）
- `server/src/answer/answer.model.ts`（新增）
- `server/src/answer/citation-validator.ts`（新增）
- `server/src/answer/claim-evidence-validator.ts`（新增）
- `server/src/search/evidence*`
- `server/src/llm/*`

### 步骤

1. 定义 Answer 输出 Schema：`answer`、`claims`、`claim_type`、`evidence_ids`、`certainty`。
2. 服务端验证 Claim 至少有 Evidence、Evidence 在本次 Pack、权限有效、Revision/Hash 未过期。
3. 对日期、数字、实体名称做基础冲突检查；区分 `fact` 与 `inference`。
4. 校验最终文本确实包含引用标记；不允许模型引用不存在的 Evidence。
5. 校验失败最多请求一次模型修复；仍失败则返回带引用的检索摘要。
6. 当 Evidence 因删除、权限或 Revision 变化失效时重新检索；不可静默使用旧证据回答当前状态。

### 验证

- 无证据 Claim 被拒绝。
- 伪造 Evidence ID、越权 Evidence、过期 Hash 和错误 certainty 被拒绝。
- 模型失败时用户仍获得结构化检索结果。
- Prompt Injection 仅作为证据文本，不改变 Answer 权限或 Tool 行为。

## 阶段 10：Approval Broker 原子状态机与执行模式

### 目标

让每次询问、托管执行和完全访问成为服务端可验证的 Grant + 状态机，而不是 UI 约定。

### 主要文件

- `server/src/approval/approval.model.ts`（新增）
- `server/src/approval/approval.repository.ts`（新增）
- `server/src/approval/approval.service.ts`（新增）
- `server/src/approval/risk-policy.service.ts`（新增）
- `server/src/operations/operation.service.ts`（新增）
- `server/src/identity/grant.service.ts`
- `server/src/audit/*`

### 步骤

1. 定义 `pending/approved/rejected/expired/executing/succeeded/failed/needs_reconciliation/cancelled` 状态。
2. 创建 Approval 时绑定 operation、owner、agent、session、channel user、Grant、Tool、arguments hash、risk 和过期时间。
3. 使用条件 UPDATE 原子批准；仅 `status=pending`、未过期、Hash 和身份匹配时允许批准。
4. 使用条件 UPDATE 抢占 `executing`；重复请求返回已存在结果，不重复执行。
5. 为外部副作用保存 idempotency key、external request ID 和 reconciliation 标记。
6. 实现三种模式：低风险读取直通；托管执行只在 Grant 范围内自动写入；删除、批量、发布和权限修改始终确认。
7. 审批卡片只展示结构化参数摘要，不能只展示自然语言描述。

### 验证

- 双击确认只有一次成功。
- 参数变化、审批过期、用户不匹配和 Grant 变化均拒绝。
- Worker / 网络重试不重复执行 Todo 或外部副作用。
- 完全访问仍不能读取凭证、远程导出 Secret 或绕过强制确认。

## 阶段 11：MCP Server 业务 Tool

### 目标

实现业务级远程 MCP，不暴露数据库、文件系统、凭证或任意 SQL。

### 主要文件

- `server/src/mcp/mcp.server.ts`（新增）
- `server/src/mcp/mcp.transport.ts`（新增）
- `server/src/mcp/mcp-tool-registry.ts`（新增）
- `server/src/mcp/mcp-auth.guard.ts`（新增）
- `server/src/mcp/mcp-response.ts`（新增）
- `server/src/mcp/tools/*`（新增）
- `server/src/main.ts`
- `server/API.md`
- `server/README.md`

### Tools

首批实现：

```text
terra_search_notes
terra_get_note
terra_find_note_facts
terra_find_related_notes
terra_summarize_notes
terra_answer_question
terra_search_todos
terra_create_todo
terra_update_todo
terra_complete_todo
terra_search_calendar
terra_create_calendar_draft
terra_plan_route
terra_workspace_summary
terra_get_sync_status
terra_get_job_status
```

### 步骤

1. 选择与当前 Node/Nest 版本兼容的 MCP Streamable HTTP 实现；若官方 SDK 不适配，则以内部协议适配器隔离依赖。
2. MCP 入口先执行 Service Identity、User Assertion、Session、Grant 和 Tool 策略检查。
3. Tool schema 固定 `readOnly`、`destructive`、`requiresConfirmation`、`privacyImpact` 和版本；模型不能覆盖。
4. Tool Handler 只调用业务 Service，不直接操作 SQLite、LanceDB、文件或凭证。
5. 统一返回 `ok`、`operation_id`、`data`、`citations`、`warnings`、`approval` 和结构化错误。
6. 对 limit、范围、批量数量、隐私等级和工具参数做服务端上限校验。
7. 暂时关闭 MCP Sampling；不支持任意 Resource、SQL、文件、凭证和原始笔记修改 Tool。
8. 加入 MCP 集成测试和断线 / 重试测试。

### 验证

- Hermes 能发现远程 Tools。
- 未认证或未映射用户无法调用。
- 只读 Tool 直接返回；写 Tool 遵循 Approval。
- Tool 参数不能扩大数据范围或隐私等级。
- MCP 错误不泄露内部路径、凭证或 SQL。

## 阶段 12：Hermes / Feishu 适配与确认恢复

### 目标

打通服务器上的 Hermes、飞书渠道、Terra 远程 MCP 和 Approval 恢复链路。

### 主要文件

- `server/API.md`
- `server/README.md`
- `docs/hermes-integration.md`（新增）
- `docs/feishu-approval-flow.md`（新增）
- Hermes 部署配置（不提交真实 Token）
- `server/scripts/mcp-hermes-smoke.cjs`（新增）

### 步骤

1. 编写 Hermes 侧 MCP URL、Service Token、超时和 Tool include 配置示例。
2. 约定并验证 User Assertion 传递方式；未签名 Header 只做诊断，不做授权。
3. 实现 `APPROVAL_REQUIRED` 结构化响应和 Approval 恢复 endpoint / Tool。
4. 设计 Feishu 确认卡片字段：操作、目标、参数、数据范围、模式、风险和过期时间。
5. 首版使用轮询查询任务和审批状态；不引入 Terra 主动推送。
6. 测试 Hermes 断线重连、Tool 重新发现、MCP 超时和重复请求。
7. 记录 Hermes Service Token 轮换、撤销和用户映射变更流程。

### 验证

- 飞书用户身份从官方事件字段到 Terra owner 映射可追踪。
- 确认卡片的参数 Hash 与最终执行参数一致。
- 过期审批不能恢复执行。
- Hermes 不持有小米凭证、Terra DPAPI 数据或 LLM Key。

## 阶段 13：客户端设置、状态展示与管理界面

### 目标

让 Android / Windows / Web 用户能查看连接、索引、任务、权限和审批状态，但不把服务器敏感数据带到前端。

### 主要文件

- `src/services/*`
- `src/shared/*`
- `src/store/*`
- `src/views/Settings.vue`
- `src/views/KnowledgeBase.vue`
- 需要时新增 `src/views/Approvals.vue`、`src/views/Jobs.vue`

### 步骤

1. 增加 LLM Provider、索引版本、任务队列、MCP、Hermes、Grant 和同步状态 API 类型。
2. 设置页只显示掩码、状态、权限范围和过期时间，不显示 Secret、Token 或 User Assertion 原文。
3. 知识库显示索引 partial/stale、BM25/Dense/Rerank 降级和一致性扫描结果。
4. 增加审批列表、确认 / 拒绝和操作详情；客户端发起确认时使用 operation / approval ID。
5. 增加后台任务列表、取消、重试和资源压力提示。
6. 前端轮询需支持卸载清理、网络失败退避和离线状态。

### 验证

- 前端构建、类型检查和移动端布局通过。
- 浏览器 DevTools、localStorage、Pinia 和错误提示中无凭证。
- 权限范围和审批摘要与服务端返回一致。

## 阶段 14：备份、恢复、迁移与一致性扫描

### 目标

使新 SQLite 状态、RAG、LanceDB、任务、审批和审计可备份、恢复和重建。

### 主要文件

- `server/scripts/terra-backup.cjs`
- `server/scripts/terra-restore.cjs`（新增）
- `server/scripts/consistency-scan.cjs`（新增）
- `server/scripts/*smoke.cjs`
- `server/README.md`
- `README.md`

### 步骤

1. 明确核心备份与可重建派生数据；备份前冻结或安全复制 SQLite 和 LanceDB manifest。
2. 加密归档 SQLite、加密原文、任务、审批、实体、事实、审计和受保护索引。
3. 排除 `.env` 明文、DPAPI 明文、Cookie、Token、API Key、HAR 和临时解密目录。
4. 恢复时先 SQLite / 密钥可用性，再正文，再 BM25，再 LanceDB，再任务 Worker。
5. 恢复后执行 Revision / Index / Evidence / Task / Approval 一致性扫描。
6. 缺失或不兼容 LanceDB 时保留正文和 BM25，安排 Dense 重建，不阻止服务启动。

### 验证

- 备份归档扫描不到敏感凭证。
- 恢复后任务、审批和幂等状态可继续。
- LanceDB 可丢失并从 Chunk 重建。
- 一致性扫描能发现并修复 stale / orphan / tombstone 状态。

## 阶段 15：完整回归、威胁审计与发布门槛

### 目标

以设计文档的 P0/P1 验收门槛作为发布标准，不以“接口能返回”代替安全和一致性验证。

### 步骤

1. 运行服务端 typecheck/build、前端 typecheck/build 和所有既有 RAG/Xiaomi/backup smoke。
2. 新增并运行：
   - `test:trace-context`
   - `test:identity-chain`
   - `test:index-security`
   - `test:task-lease`
   - `test:approval-atomicity`
   - `test:rank-fusion`
   - `test:evidence-validation`
   - `test:revision-consistency`
   - `test:permission-matrix`
   - `test:mcp-contract`
   - `test:mcp-hermes`
   - `test:backup-security`
3. 用固定假凭证和敏感字符串运行出站请求拦截测试，确认没有远程泄漏。
4. 运行并发测试：双 Worker、双击审批、MCP 重试、Lease 过期、Content Hash 变化。
5. 运行 Prompt Injection fixture，确认笔记内容不能改变权限、Tool 或执行模式。
6. 检查 API、MCP schema、前端响应、日志、备份和 Git diff。
7. 记录可接受的剩余风险和明确不支持的能力：多租户、外部日历发布、删除原始笔记、Secret 远程访问。

## 分阶段交付检查点

1. 阶段 0–2：基础配置、Trace、审计和 SQLite 状态层，不改变既有用户流程。
2. 阶段 3–4：Hermes 身份与索引安全边界完成；MCP 仍可保持关闭。
3. 阶段 5–6：可靠 Worker 与 LLM Gateway 完成，所有任务可降级。
4. 阶段 7–9：实体、事实、Hybrid Search、Rerank、Evidence 和 Answer 完成。
5. 阶段 10–12：Approval、业务 MCP、Hermes / Feishu 确认链路完成。
6. 阶段 13–14：客户端管理界面、备份、恢复和一致性扫描完成。
7. 阶段 15：全量回归和威胁审计通过后，才启用远程 Hermes MCP 写操作。

## 最终完成标准

- P0 身份信任链与索引数据安全边界通过自动化测试和代码审计。
- P1 Task Lease、Approval 原子状态、Weighted RRF、Claim → Evidence、一致性和权限矩阵均有实现和测试证据。
- 现有小米笔记同步、RAG、备份和客户端功能无回归。
- LLM、Rerank、LanceDB 或 Worker 故障不会阻止基础笔记、Todo 和状态查询。
- Hermes 可以通过远程 HTTPS MCP 使用业务级 Tools，但不能访问数据库、文件系统、凭证或任意 SQL。
- 真实凭证只存在于用户明确配置的安全存储中，不进入源码、日志、测试、备份或提交。
