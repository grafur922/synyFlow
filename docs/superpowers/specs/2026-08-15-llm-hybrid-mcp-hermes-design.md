# Terra LLM、Hybrid Search、MCP 与 Hermes 集成设计

- 日期：2026-08-15
- 状态：设计已确认，等待用户 review
- 范围：LLM Gateway、知识库增强、Hybrid Search、业务级 MCP、Hermes 远程集成、权限审批、审计与可观测性
- 部署假设：Terra 与 Hermes 部署在服务器；Android / Windows 访问 Terra；Hermes 通过飞书提供消息入口；当前单用户

## 1. 目标与非目标

### 1.1 目标

1. 为笔记、Todo、日程、路线和工作区总结提供统一的业务能力层。
2. 接入可替换的 LLM Gateway，用于实体/关系提取、结构化、摘要、Query Understanding、Rerank 与最终回答。
3. 采用关键词、向量、结构化查询、实体关系和条件 Rerank 组成的 Hybrid Search。
4. 通过证据包和引用约束最终回答，保留不确定与冲突事实。
5. 通过远程 HTTPS Streamable HTTP MCP 向 Hermes 暴露业务级 Tools。
6. 支持“每次询问、托管执行、完全访问”三种用户选择的执行模式。
7. 在不引入多租户复杂度的前提下，保留 agent、session、grant 和渠道身份边界。
8. 在低性能服务器上以 SQLite 持久化任务队列，支持降级和恢复。
9. 为跨飞书、Hermes、Terra、LLM、搜索、审批和后台任务的链路提供 trace context。

### 1.2 非目标

1. 首版不引入 Neo4j、Redis、RabbitMQ 或独立工作流平台。
2. 首版不让 Hermes 直接访问 SQLite、LanceDB、原始小米凭证或内部 API。
3. 首版不暴露任意 SQL、任意文件操作或任意外部 API 调用 Tool。
4. 首版不使用 MCP Sampling 让 Terra 反向调用 Hermes 的 LLM。
5. 首版不实现多用户、多租户或团队协作权限模型。
6. 首版不自动发布外部日历事件、不删除笔记、不修改小米原始笔记。
7. 冲突事实不设置固定“展示两条”规则；正常结果直接展示，只有实际存在冲突时才并列展示。

## 2. 总体架构

采用模块化单体 Terra，内部预留拆分边界：

```text
Android / Windows ──HTTPS API──> Terra
                                    ├─ Document / Xiaomi Notes
                                    ├─ Knowledge / Indexing
                                    ├─ Entity Graph
                                    ├─ Hybrid Search
                                    ├─ LLM Gateway
                                    ├─ LLM Task Queue
                                    ├─ Answer / Citation Engine
                                    ├─ Approval Broker
                                    ├─ MCP Server
                                    ├─ Audit / Observability
                                    ├─ SQLite
                                    └─ LanceDB

Feishu ──> Hermes ──HTTPS Streamable HTTP MCP──> Terra MCP Server
```

Terra 内部服务边界：

```text
DocumentService
IndexService
EntityService
LLMService
TaskQueueService
SearchService
AnswerService
ApprovalService
McpService
AuditService
```

首版以一个 Terra 服务进程部署；未来可拆为 Terra API、Terra AI Worker 和 Terra MCP Gateway，外部 Tool Schema 不变。

### 2.1 模块职责

- Document / Xiaomi Notes：同步、版本、加密原文、删除状态和索引任务触发。
- Knowledge / Indexing：Chunk、BM25、Embedding、LanceDB、索引版本和删除。
- Entity Graph：实体、提及、关系、事实、人工确认和冲突历史。
- LLM Gateway：Provider、模型、Prompt 版本、Schema、超时、重试、隐私和成本控制。
- LLM Task Queue：持久化异步任务、幂等、重试、限流和恢复。
- Query Compiler：将自然语言编译为白名单 QueryPlan，不能直接执行 SQL 或 Tool。
- Hybrid Search：多路召回、融合、条件 Rerank 和 Evidence Pack。
- Answer Engine：只根据 Evidence Pack 生成带引用回答。
- MCP Server：协议适配、身份传递、参数校验、权限检查和业务调用。
- Approval Broker：高风险操作确认、过期、防重放和参数绑定。
- Audit / Observability：审计、日志、指标、trace context 和错误诊断。

## 3. 数据模型

### 3.1 文档与版本

逻辑关系：

```text
documents -> document_revisions -> document_chunks
```

`documents`：

```text
id
source                         -- xiaomi_notes / local / manual
source_document_id
title
current_revision_id
privacy_class                  -- public / private / secret
deleted_at
created_at
updated_at
last_synced_at
```

`document_revisions`：

```text
id
document_id
revision_number
content_hash
title_snapshot
content_encrypted
content_length
source_updated_at
synced_at
is_current
created_at
```

规则：内容 Hash 不变不创建新版本；内容变化创建新 Revision；历史版本保留；删除采用逻辑删除；当前版本用于普通搜索，历史版本用于时间查询、审计和事实冲突。

`document_chunks`：

```text
id
revision_id
chunk_index
content_encrypted
content_hash
start_offset
end_offset
heading_path
token_estimate
embedding_status
keyword_index_status
created_at
```

每个 Chunk 必须可定位回 `document_id`、`revision_id`、`chunk_id`、`start_offset` 和 `end_offset`。

### 3.2 实体与关系

`entities`：

```text
id
canonical_name
entity_type
aliases_json
description
status
privacy_class
first_seen_at
last_seen_at
created_by                     -- llm / user / system
created_at
updated_at
```

核心类型：`Person`、`Organization`、`Place`、`Project`、`Task`、`Event`、`Time`、`Item`、`Topic`；允许受控自定义类型，例如 `Book`、`Vehicle`、`Course`、`Custom`。

`entity_mentions`：

```text
id
entity_id
document_id
revision_id
chunk_id
mention_text
start_offset
end_offset
context_text
confidence
extraction_run_id
review_status
created_at
```

`relations`：

```text
id
subject_entity_id
predicate
object_entity_id
status
confidence
valid_from
valid_to
is_current
created_by
created_at
updated_at
```

`relation_mentions`：

```text
id
relation_id
document_id
revision_id
chunk_id
evidence_text
subject_span
predicate_span
object_span
confidence
extraction_run_id
review_status
created_at
```

关系状态：`candidate`、`confirmed`、`rejected`、`superseded`、`supported`、`uncertain`、`historical`、`contradicted`。

### 3.3 结构化事实

`structured_facts`：

```text
id
subject_entity_id
fact_type
attribute_key
value_text
value_number
value_bool
value_date
value_json
unit
source_document_id
source_revision_id
source_chunk_id
source_span
confidence
certainty
status
observed_at
valid_from
valid_to
is_current
created_by
created_at
updated_at
```

数值、布尔、日期、文本采用分离字段；复杂值才使用受限 JSON。实体、关系和事实都必须保留来源 Chunk 与原文 Span。

### 3.4 冲突事实

同一属性的不同值不互相覆盖，而是并列保存。排序优先级：

```text
用户确认状态
> 当前有效性
> 事实时间新旧
> 来源可信度
> LLM confidence
> 记录时间
```

展示规则：

- 没有真实冲突时直接展示相关结果。
- 存在冲突时并列展示来源、时间和状态。
- 不固定展示两条，也不为了展示历史而强制添加结果。
- 用户要求“全部”“历史”或“存疑”时扩展范围。
- 已拒绝事实默认不展示，但保留审计历史。
- 回答中使用“当前记录”“较早记录”“存疑”“尚未确认”等明确标记。

人工确认结果必须不可被后续自动抽取覆盖。新模型只能生成候选，并在冲突时标记 `contradicted` 或 `uncertain`。

### 3.5 LLM 运行和任务

`llm_extraction_runs`：

```text
id
document_id
revision_id
chunk_id
task_type
provider
model
prompt_version
input_hash
output_hash
status
started_at
finished_at
error_code
created_at
```

`llm_task_queue` 任务状态：

```text
pending / running / succeeded / failed / cancelled / retry_waiting
```

任务幂等键由以下字段构成：

```text
document_id + revision_id + chunk_id + task_type
+ provider + model + prompt_version + input_hash
```

## 4. LLM Gateway 与调用边界

### 4.1 统一接口

```ts
interface LlmGateway {
  generate<T>(request: LlmGenerateRequest): Promise<LlmGenerateResult<T>>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  rerank(request: RerankRequest): Promise<RerankResult>;
  health(): Promise<ProviderHealth>;
}
```

支持 Aliyun、OpenAI-compatible Provider、Ollama 和未来 Provider。业务模块不得直接调用具体 Provider SDK。

### 4.2 任务类型

```text
entity_extraction
relation_extraction
fact_extraction
document_structuring
document_summary
query_understanding
answer_generation
embedding
rerank
```

每种任务固定输入限制、输出 Schema、默认模型、隐私策略、超时和降级行为。

### 4.3 同步 / 异步

同步：Query Understanding、搜索、简单摘要、最终问答、Todo / 日程查询。建议超时：Query Understanding 3～8 秒，Rerank 3～8 秒，Answer 10～30 秒。

异步：摘要、实体、关系、事实抽取、批量 Embedding、历史重建。后台任务使用 SQLite 持久化，默认并发为 1，支持重试、退避、取消、暂停和进程重启恢复。

同步索引顺序：

```text
小米同步
  -> 加密正文立即可用
  -> BM25 立即更新
  -> 异步摘要 / 实体 / 关系 / 事实 / Embedding
```

### 4.4 隐私路由

隐私等级：

- `public`：允许远程 LLM。
- `private`：允许远程 LLM，但只发送最小必要内容，并要求当前授权。
- `secret`：禁止远程 LLM，只走本地模型或规则。

无论隐私等级，下列内容都禁止发送远程模型：

```text
Cookie、serviceToken、passtoken、deviceId、API Key、Access Token、Refresh Token、密码、私钥、DPAPI 解密结果、完整请求头、完整 HAR
```

远程调用前执行字段级检测、文本模式检测和高熵检测。失败时优先本地处理，不能处理则明确返回受隐私策略限制。

### 4.5 输出校验

所有抽取任务使用 JSON Schema，并校验：JSON、字段、类型、数量、长度、Confidence、日期、关系主体，以及 Source Span 是否真实存在于输入文本。失败时最多进行一次结构化修复，仍失败则不写入实体图。

### 4.6 降级

```text
Query Understanding 失败 -> 本地规则 -> 普通关键词 / 向量检索
Embedding 失败         -> BM25 + 结构化查询
Rerank 失败            -> 本地融合排序
Answer LLM 失败        -> 结构化结果 + 模板化摘要
```

LLM 是增强能力，不是基础可用性的唯一依赖。

## 5. Hybrid Search

### 5.1 QueryPlan

```json
{
  "intent": "search_notes",
  "normalized_query": "服务器部署",
  "keywords": ["服务器", "部署"],
  "entities": [],
  "relation_constraints": [],
  "time_range": {},
  "structured_filters": {},
  "retrieval_mode": "hybrid",
  "rerank_mode": "auto",
  "limit": 10,
  "answer_mode": "raw_results"
}
```

本地规则优先；复杂查询才调用 Query Understanding LLM。LLM 只能生成计划，不能直接生成或执行 SQL、Tool、文件操作或权限变更。

### 5.2 多路召回

默认候选：BM25 Top 30、Dense Top 30、结构化 Top 30、实体 / 关系 Top 30。以 `chunk_id` 去重但保留所有路径分数：

```text
bm25_score
vector_score
structured_score
entity_score
matched_terms
matched_entities
```

### 5.3 融合排序

默认可解释加权：

```text
0.35 * normalized_bm25
+ 0.35 * normalized_vector
+ 0.20 * structured
+ 0.10 * entity_relation
```

查询类型可调整权重：精确配置提高 BM25；概念问题提高 Vector；时间和状态查询提高结构化；实体关系查询提高图查询。

### 5.4 Rerank

默认 `rerank_mode=auto`。普通查询不调用 Rerank。复杂问题、最终问答、候选分数接近、召回路径冲突、用户要求高精度或 Tool 要求高精度时，对 Top 20～50 候选调用专用 Reranker Provider。

支持：

```text
off / auto / required
```

Rerank 缓存键包含 Query、候选 Hash、隐私范围、模型和版本。Rerank 失败时回退本地融合排序。

### 5.5 Evidence Pack

最终回答只接收 Evidence Pack：

```ts
interface EvidencePack {
  query: string;
  items: EvidenceItem[];
  conflicts: ConflictGroup[];
  answer_constraints: {
    cite_every_claim: boolean;
    mention_uncertainty: boolean;
    latest_first: boolean;
    do_not_invent: boolean;
  };
}
```

每个证据包含文档、Revision、Chunk、标题、更新时间、正文片段、引用位置、检索路径、分数、确定性和状态。

## 6. Answer Engine

```text
Query
  -> QueryPlan
  -> Hybrid Search
  -> 必要时 Rerank
  -> Evidence Pack
  -> Answer LLM
  -> Citation / Schema 校验
  -> 最终回答
```

Answer LLM：

- 只能使用 Evidence Pack；
- 关键结论必须有引用；
- 无足够证据必须说明；
- 不得自由补充外部事实；
- 冲突事实并列呈现；
- 不确定事实显式标记；
- 不能直接调用工具；
- 不能修改 QueryPlan 或执行模式。

## 7. MCP Server

首版采用远程 HTTPS Streamable HTTP MCP：

```text
Hermes -> HTTPS MCP -> Terra
```

业务级 Tools：

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

禁止：

```text
terra_sql
terra_raw_search
terra_patch_document
terra_call_api
terra_read_secret
terra_manage_credentials
```

每个 Tool 有不可由模型修改的策略：

```json
{
  "readOnly": true,
  "destructive": false,
  "requiresConfirmation": false,
  "privacyImpact": "private",
  "supportsManagedExecution": true
}
```

统一响应：

```json
{
  "ok": true,
  "operation_id": "op_...",
  "data": {},
  "citations": [],
  "warnings": [],
  "approval": null
}
```

## 8. 身份、权限和执行模式

当前单用户，但保留：

```text
owner_id
agent_id
session_id
grant_id
channel
channel_user_id
```

Hermes Service Token 只证明 Hermes 被允许接入 Terra，不等同于用户完全授权。Terra 重新校验 Service Token、Agent、渠道用户、Session、Grant、Tool 和隐私范围。

### 8.1 每次询问

单次授权、短时过期、适用于删除、发布、修改原始笔记和高风险批量操作。

### 8.2 托管执行

短期 Capability，默认 30 分钟；限定 Tool、项目、来源和隐私范围。低 / 中风险操作可自动执行；删除、发布、批量修改仍逐次确认。

### 8.3 完全访问

最长 1 小时，不提供永久开启。减少逐次确认，但仍不能读取或导出凭证、绕过 Schema、突破 Secret 限制、取消审计、突破限流或自动执行删除、批量修改、外部发布等强制确认操作。

## 9. Approval Broker

审批请求绑定：

```text
approval_id
operation_id
owner_id
agent_id
session_id
channel
channel_user_id
grant_id
tool_name
arguments_hash
risk_level
expires_at
```

确认时重新计算 `arguments_hash`。参数变化、审批过期、用户不匹配或重复使用时拒绝执行。

状态：

```text
pending / approved / rejected / expired / executing / succeeded / failed / cancelled
```

确认渠道：Feishu、Android、Windows、Terra Web UI，统一进入 Approval Broker。

## 10. Hermes 集成

Hermes 侧仅保存：

```text
Terra MCP URL
Hermes Service Token
连接超时
Tool 过滤配置
```

不保存小米凭证、Terra DPAPI 数据或 LLM Provider Key。

推荐配置语义：

```yaml
mcp_servers:
  terra:
    url: "https://terra.example.com/mcp"
    headers:
      Authorization: "Bearer ${TERRA_HERMES_SERVICE_TOKEN}"
    tools:
      include:
        - terra_search_notes
        - terra_answer_question
        - terra_search_todos
        - terra_create_todo
        - terra_get_sync_status
```

Terra 可接收 `X-Terra-Agent-Id`、`X-Terra-Channel`、`X-Terra-Channel-User` 和 `X-Terra-Session-Id` 作为身份线索，但 Header 不替代服务端授权。

首版关闭 MCP Sampling。Terra 的模型能力统一走 Terra LLM Gateway，避免调用链循环和隐私策略分裂。

Hermes / Feishu 调用链：

```text
Feishu User
  -> Hermes Session
  -> Terra MCP
  -> identity / grant / risk check
  -> business Tool
  -> result or approval_required
```

高风险操作返回结构化 Approval，不把审批参数只放在自然语言中。首版审批先支持轮询恢复；后续可增加 Terra 主动通知。

## 11. Trace Context

由于链路跨越 Hermes、MCP、Terra、搜索、Rerank、LLM、后台队列和审批，加入 Trace Context。

区分：

```text
trace_id       串联一次逻辑请求链路
span_id        标识一个内部步骤
request_id     标识一次网络请求
operation_id   标识可恢复的业务操作
job_id         标识异步任务
approval_id    标识用户确认
idempotency_key 防止业务重复写入
```

推荐上下文：

```ts
interface RequestContext {
  traceId: string;
  requestId: string;
  parentSpanId?: string;
  spanId: string;
  operationId?: string;
  jobId?: string;
  approvalId?: string;
  ownerId: string;
  agentId?: string;
  sessionId?: string;
}
```

Terra 接收请求时生成或校验 Trace ID；内部 Service、MCP、LLM Gateway、任务和审批继续传递。Trace ID 不用于权限、审批或幂等。

日志和审计至少包含：

```text
trace_id
request_id
span_id
operation_id
job_id
approval_id
```

成功请求不必向用户显示 Trace ID；错误或降级时显示可复制的 Trace ID 和错误码。日志不保存完整 Query、正文、凭证、Prompt 或模型输出原文。

## 12. 审计与可观测性

核心审计表 `audit_events`：

```text
id
trace_id
request_id
span_id
operation_id
owner_id
agent_id
session_id
channel
channel_user_id
grant_id
event_type
tool_name
resource_type
resource_id
arguments_hash
privacy_class
risk_level
result_status
error_code
created_at
```

事件包括请求、权限、查询计划、搜索、Rerank、LLM、降级、同步、索引、审批和凭证拒绝。

指标：

```text
HTTP / MCP 请求数与延迟
LLM 调用、失败、降级与延迟
Embedding / 抽取队列深度
搜索 / Rerank 延迟与缓存命中
审批待处理与过期
小米同步成功与失败
索引过期文档数
内存压力事件
```

提供 `/health`、`/ready`、`/metrics`；不得返回凭证、正文或敏感路径。

## 13. 数据生命周期、备份和恢复

原始加密文档、SQLite、实体关系、结构化事实、任务队列和审计记录属于核心备份数据。Embedding、BM25、摘要和 Rerank 缓存属于可重建派生数据。

备份禁止保存：

```text
明文 Cookie
明文 Token
明文 API Key
DPAPI 解密结果
```

恢复顺序：

```text
SQLite
-> 加密密钥
-> 加密文档
-> BM25
-> LanceDB
-> 失效向量标记
-> 未完成任务
-> 后台 Worker
-> 一致性扫描
```

一致性扫描检查 Revision、Chunk、Embedding Content Hash、实体 Mention、关系主体客体、任务状态和过期 Approval。

## 14. 主要技术风险与缓解

### LLM 幻觉

使用 JSON Schema、Source Span、Evidence Pack、Citation 校验、用户确认和无证据拒答。

### 隐私泄漏

字段级拒绝、文本敏感检测、Secret 本地路由、MCP 禁止凭证 Tool、日志脱敏和最小化上下文。

### 实体错误合并

实体与 Mention 分离；低置信度为候选；人工确认不可覆盖；合并和拆分可审计。

### 事实过期

保存有效时间、来源更新时间和当前状态；过期事实降低排序但不静默删除。

### 索引不一致

派生数据绑定 Content Hash；Revision 更新使旧索引失效；启动时一致性扫描。

### Provider 不稳定

Provider 抽象、超时、重试、版本固定、本地 BM25 降级和 Embedding 维度隔离。

### 低性能服务器

后台并发默认 1、Chunk 分批、资源阈值暂停、用户请求优先、任务可取消、不默认运行大型本地模型。

### MCP 重放与重复写入

Operation、幂等键、参数 Hash、用户和渠道绑定、过期、单次审批和状态机。

### Prompt Injection

笔记只能作为 Evidence；不能改变权限、QueryPlan、执行模式或 Tool 调用。

### Tool Schema 漂移

Schema 版本、向后兼容、服务端再次校验、Tool 变更迁移期和真实 MCP 集成测试。

## 15. 首版验收标准

### LLM

- 实体、关系和事实输出符合 Schema。
- 抽取结果都有有效 Source Span。
- 人工确认不会被自动任务覆盖。
- 远程模型失败时可重试和降级。
- Secret 和凭证不会发送到远程 Provider。

### Search

- BM25、Dense 和结构化查询可独立工作。
- 多路结果可去重和融合。
- 普通搜索不强制 Rerank。
- 复杂查询能触发 Rerank。
- Rerank 失败回退本地排序。
- 搜索结果保留引用和召回路径。

### Answer

- 回答只能使用 Evidence Pack。
- 关键结论带引用。
- 没有证据时明确说明。
- 实际存在冲突时并列展示。
- 笔记中的 Prompt Injection 不改变权限。

### MCP / Hermes

- Hermes 可通过 HTTPS MCP 发现 Terra Tools。
- 只读 Tool 可以直接调用。
- 写 Tool 遵循执行模式。
- 需要审批时返回结构化 Approval。
- 参数变化会使原审批失效。
- 网络重试不会重复写入。
- 过期 Approval 不能执行。
- Service Token 可撤销。

### Recovery

- SQLite 和加密文档可恢复。
- 任务队列可恢复。
- 向量可重建。
- 一致性扫描可运行。
- 敏感配置不会进入明文备份。

## 16. 结论

Terra 是数据、检索、隐私、权限、审批和事实准确性的控制面；Hermes 是 Agent 规划和消息渠道；飞书是交互和确认界面。

系统采用模块化单体实现首版，但通过明确的 Service、Task Queue、LLM Gateway、MCP、Approval Broker 和 Audit 边界，保留未来拆分为 API、AI Worker 和 MCP Gateway 的能力。

所有高级能力均可降级，LLM 不成为系统基础依赖；所有外部 Agent 能力均通过业务级 Tool 暴露，不直接暴露数据库、文件系统和凭证。

## 17. P0 / P1 强制补充约束

本节是对前述设计的强制补充。P0 是开始实现前必须明确并满足的安全边界；P1 是首版必须实现或具备可验证降级行为的可靠性与一致性约束。

### 17.1 P0：Hermes → Terra 身份信任链

Hermes 调用 Terra 时必须同时建立 Service Identity 和 User Identity，不能把二者合并为一个 Token，也不能把普通 Header 直接当作用户身份。

```text
Feishu event
  -> Hermes Feishu adapter verifies event source
  -> extract channel_user_id
  -> Hermes signs User Assertion
  -> Terra verifies Hermes Service Token
  -> Terra verifies User Assertion
  -> channel_user_id -> owner_id mapping
  -> Session / Grant / Tool / data-scope check
```

#### Service Identity

Hermes 使用专用 Bearer Service Token：

```http
Authorization: Bearer <TERRA_HERMES_SERVICE_TOKEN>
```

Terra 只保存 Token Hash。Token 记录至少包含：

```text
agent_id
allowed_channels
allowed_tools
expires_at
revoked_at
last_used_at
```

Service Token 只证明调用方是已注册的 Hermes 实例，不代表当前用户拥有全部 Terra 权限。

#### User Identity

Hermes 必须对渠道用户身份生成签名断言。首选 Ed25519；如果首版使用 HMAC，必须将其作为过渡方案，并为后续迁移保留断言版本字段。

断言至少包含：

```json
{
  "iss": "hermes",
  "agent_id": "hermes-prod-01",
  "channel": "feishu",
  "channel_user_id": "feishu:open_id:ou_xxx",
  "session_id": "session_xxx",
  "iat": 1787xxxxxx,
  "exp": 1787xxxxxx,
  "nonce": "nonce_xxx"
}
```

Terra 保存 Hermes 公钥或共享密钥，并验证：签名、issuer、agent_id、iat、exp、nonce、session 绑定和断言版本。

`owner_id` 不由 Hermes 直接指定。Terra 根据 `channel + channel_user_id` 在服务端查找映射：

```text
(channel, channel_user_id) -> owner_id
```

当前单用户模式只配置一个允许映射；未映射用户直接拒绝。

#### `channel_user_id` 来源

`channel_user_id` 必须来自飞书官方事件负载中的发送者身份字段，由 Hermes 飞书适配器提取和规范化。不能来自消息正文、普通 HTTP Header、自然语言推断或 Hermes 自由生成的 `owner_id`。

规范化格式示例：

```text
feishu:open_id:<value>
```

实际使用的 Feishu 用户标识类型必须由适配器固定选择，不得在每次调用中变化。

#### Header 信任规则

| 信息 | 默认可信度 | 信任条件 |
|---|---:|---|
| `Authorization` | 可用于 Service Identity | HTTPS、Token Hash 校验通过、Token 未撤销 |
| 签名 User Assertion | 可用于 User Identity | 签名、时效、nonce、agent 和 session 校验通过 |
| `X-Terra-Agent-Id` | 不可信 | 仅辅助诊断，不能单独授权 |
| `X-Terra-Channel` | 不可信 | 只有出现在签名断言中才参与授权 |
| `X-Terra-Channel-User` | 不可信 | 只有出现在签名断言中才参与授权 |
| `X-Terra-Session-Id` | 不可信 | 只有出现在签名断言中才参与授权 |
| `X-Trace-Id` | 不可信 | 只用于链路关联，不能用于权限、审批或幂等 |

Terra 必须拒绝过期、重复使用、签名错误、用户映射不存在或渠道不匹配的断言。

### 17.2 P0：索引数据安全边界

索引数据不是“非敏感数据”。即使不含正文，词项、向量、实体、摘要和检索缓存也可能泄露用户的主题、配置和行为。

#### 数据分类

| 数据 | 分类 | 持久化要求 | 远程发送规则 |
|---|---|---|---|
| 原始笔记正文 | 高敏感原始数据 | 应用层加密 | 按隐私策略最小化发送 |
| BM25 词项、词频、位置 | 敏感派生数据 | 加密状态或加密磁盘 | 不作为索引文件发送 |
| Embedding 向量 | 敏感派生数据 | 受保护数据目录 | `secret` 禁止远程生成 |
| Entity / Relation / Fact | 敏感派生数据 | 受保护数据库 | 按来源隐私级别 |
| 摘要 | 敏感派生数据 | 受保护数据库 | 按来源隐私级别 |
| Rerank 缓存 | 敏感派生数据 | 可设 TTL，禁止普通日志 | 不发送到外部日志 |
| Cookie / Token / API Key | 凭证 | 不得进入任何索引 | 永久禁止 |

当前实现中，BM25 `terms` 位于加密 RAG 状态中；LanceDB 当前保存向量及最小元数据，不保存 Chunk 正文。后续实现必须继续保持这一边界。

#### BM25

BM25 不得作为未保护的明文独立文件持久化。若后续改用 SQLite FTS5 或其他持久化倒排索引，必须使用加密数据库或受操作系统保护的加密数据卷，并限制 Terra 服务账户访问。

`secret` 内容默认不进入持久化 BM25。需要搜索时只允许本地解密、规则或本地模型临时处理，结果用完清理。

#### LanceDB

LanceDB 只保存向量和最小必要元数据：

```text
chunk_id
document_id
revision_id
content_hash
privacy_class
index_version
injection_risk
vector
```

不得保存正文、标题、Snippet、Cookie、Token 或完整结构化字段。LanceDB 文件必须位于受保护数据目录，备份时加密，并且不能通过 MCP 暴露文件路径或原始行。

`secret` 不得进入远程 Embedding、远程 Rerank、远程 Answer 或持久化 LanceDB。即使是“完全访问”，也不能通过远程 Hermes 导出 `secret` 原文或凭证。

#### 备份

备份可以包含加密原文、加密 SQLite、受保护的 BM25、LanceDB、任务队列、实体关系、事实和审计记录，但解密密钥必须与备份文件分离：

```text
backup archive = encrypted data
DPAPI / environment secret / KMS = decryption key
```

禁止将数据和解密密钥放入同一个压缩包，禁止把明文索引、Cookie、Token 或 API Key 写入备份和日志。

### 17.3 P1：SQLite Task Queue Lease / Heartbeat / Worker

任务表增加或等价支持：

```text
status
priority
available_at
lease_owner
lease_expires_at
heartbeat_at
attempt_count
max_attempts
last_error_code
last_error_message
trace_id
operation_id
idempotency_key
```

Worker 使用 `BEGIN IMMEDIATE` 或等价的原子事务领取任务：

```text
pending task or expired running task
  -> running
  -> lease_owner = worker_id
  -> lease_expires_at = now + lease_duration
  -> heartbeat_at = now
```

同一时刻只能存在一个有效 Lease。长任务按约为 `lease_duration / 3` 的间隔发送 Heartbeat。进程崩溃后 Lease 过期，任务回到可领取状态，按重试次数和指数退避继续执行；达到上限进入 `failed`。

任务输出必须使用幂等键和唯一约束，不能因为 Lease 过期或 Worker 重启生成重复实体、Embedding、摘要或写操作。

### 17.4 P1：Approval Broker 原子状态转移

Approval 状态机固定为：

```text
pending
  -> approved / rejected / expired
approved
  -> executing
executing
  -> succeeded / failed / needs_reconciliation
```

禁止从终态回退或重复执行。

批准动作必须使用条件更新，同时校验：

```text
approval_id
owner_id
channel_user_id
session_id
grant_id
arguments_hash
expires_at
status = pending
```

只有受影响行数为 `1` 时批准才成功。执行阶段同样使用条件更新抢占 `executing` 状态；只有成功抢占的 Worker 才能执行。

外部副作用必须记录：

```text
idempotency_key
external_request_id
needs_reconciliation
```

不能把“网络超时”直接当作“外部操作一定没有执行”。

### 17.5 P1：Hybrid Search Rank Fusion / Score Normalization

BM25、向量距离、结构化命中和实体分数不直接相加。首版默认使用 Weighted Reciprocal Rank Fusion：

```text
rrf_score(d) = sum(weight[channel] / (rrf_k + rank_channel(d)))
```

初始配置：

```text
rrf_k = 60
keyword_weight = 1.00
vector_weight = 1.00
structured_weight = 1.20
entity_relation_weight = 1.10
```

结构化条件分为：

- 硬过滤：状态、来源、日期范围、文档 ID 等，必须在排序前排除不符合结果；
- 软匹配：实体命中、标题命中、新鲜度等，可参与排序。

展示和调试使用：

```text
normalized_score = clamp(
  (rrf_score - p10) / max(p90 - p10, epsilon),
  0,
  1
)
```

候选过少或分数无差异时使用排名归一化：

```text
rank_score = 1 - (rank - 1) / max(candidate_count - 1, 1)
```

最终本地排序初始公式：

```text
0.80 * normalized_rrf
+ 0.10 * entity_relation_boost
+ 0.05 * exact_match_boost
+ 0.05 * freshness_boost
```

稳定 Tie-break：

```text
用户确认状态
-> 当前 Revision
-> source_updated_at 新到旧
-> normalized_score 高到低
-> document_id / chunk_id 稳定排序
```

普通搜索仍不强制 Rerank；Rerank 只在既定 `auto` 触发条件下处理有限候选。

### 17.6 P1：Evidence Pack 的 Claim -> Evidence 验证

Answer LLM 必须返回结构化结果，而不是只有未经验证的 Markdown：

```json
{
  "answer": "当前服务器配置为 4 GB 内存。[e1]",
  "claims": [
    {
      "claim_id": "c1",
      "text": "当前服务器配置为 4 GB 内存",
      "claim_type": "fact",
      "evidence_ids": ["e1"],
      "certainty": "confirmed"
    }
  ]
}
```

服务端必须验证：

1. 每个 Claim 至少拥有一个 Evidence ID；
2. Evidence ID 属于本次 Evidence Pack；
3. Evidence 在当前权限范围内；
4. Evidence Revision 和 Content Hash 仍有效；
5. Claim 中的实体、数字、日期与 Evidence 不冲突；
6. 最终答案确实包含对应引用；
7. `uncertain` 和 `inference` 不得标记为 `confirmed`。

`fact` 表示原文直接支持；`inference` 表示基于多个 Evidence 的推断，必须显式标记为“推断”或“可能”。

验证失败时最多请求一次模型修正；再次失败则降级为带引用的检索摘要，不发布不受支持的完整回答。服务端不能只相信模型自报的证据关系。

### 17.7 P1：Revision / Index / Evidence 一致性

所有派生索引和 Evidence 都必须绑定：

```text
document_id
revision_id
content_hash
index_version
privacy_class
status
```

状态约定：

```text
Revision: current / historical / deleted
Index: pending / ready / stale / deleted
Evidence: valid / stale / revoked
```

内容更新流程：

```text
保存新 Revision
  -> 旧 Revision = historical
  -> 旧索引 = stale
  -> BM25 更新
  -> Embedding / Entity / Relation / Fact 任务入队
  -> 新索引 ready
  -> 旧索引删除或保留为历史索引
```

SQLite 作为一致性事实源，LanceDB 通过持久化任务队列、Outbox、幂等写入和 Tombstone 与其最终一致。启动时执行一致性扫描。

Evidence 必须记录：

```text
evidence_id
document_id
revision_id
chunk_id
content_hash
source_span
index_version
retrieved_at
```

调用 Answer LLM 前重新验证 Revision 和 Content Hash。内容发生变化时默认重新检索；如果明确使用历史 Revision，必须标记为历史证据。不得静默使用过期索引回答当前状态。

如果最新正文可用但语义索引尚未完成，可以返回 BM25 结果，同时标记：

```text
index_status = partial
warning = SEMANTIC_INDEX_PENDING
```

已删除或权限失效的 Evidence 必须从 Evidence Pack 移除，必要时重新检索。

### 17.8 P1：Tool × Data × Grant × Execution Mode 权限矩阵

有效授权必须同时满足：

```text
Service Identity
AND User Identity
AND Session
AND Grant 未过期
AND Tool 在 Grant 范围内
AND 数据在 Grant 范围内
AND 隐私策略允许
AND 执行模式允许
AND 风险规则允许
```

Grant 至少包含：

```text
owner_id
agent_id
channel
channel_user_id
session_id
allowed_tools
allowed_sources
allowed_projects
max_privacy_class
allowed_risk_levels
allow_write
allow_batch
expires_at
mode
```

数据级别：

```text
public / private / secret / credential
```

权限矩阵：

| Tool / 操作 | Public / Private | Secret | Credential | 每次询问 | 托管执行 | 完全访问 |
|---|---|---|---|---|---|---|
| 搜索 / 获取笔记 | 允许 | Hermes 远程拒绝原文；本地安全会话可选 | 拒绝 | 直接 | 直接 | 直接 |
| 查询事实 / 关系 | 允许 | 默认拒绝敏感值 | 拒绝 | 直接 | 直接 | 直接 |
| 摘要 / 问答 | 按 LLM 隐私路由 | 仅本地模型 | 拒绝 | 直接 | 直接 | 直接 |
| 查询 Todo / 日程 | 允许 | 不适用 | 拒绝 | 直接 | 直接 | 直接 |
| 创建 / 修改 / 完成 Todo | 允许 | 不适用 | 拒绝 | 每次确认 | Grant 允许时自动 | 单对象可自动 |
| 创建日程草稿 | 允许 | 不适用 | 拒绝 | 每次确认 | Grant 允许时自动 | 可自动 |
| 发布日程 / 外部副作用 | 允许 | 不适用 | 拒绝 | 每次确认 | 仍需确认 | 仍需确认 |
| 删除 / 批量修改 | 允许 | 不适用 | 拒绝 | 每次确认 | 仍需确认 | 仍需确认 |
| 同步状态 | 只返回状态元数据 | 不返回凭证 | 拒绝 | 直接 | 直接 | 直接 |
| 读取 Cookie / Token / Key | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |

“每次询问”只表示高风险写操作逐次确认，不表示所有低风险读取都需要询问。“完全访问”也不能突破凭证禁止、Secret 远程外发禁止、删除 / 批量修改 / 外部发布强制确认和审计边界。

## 18. P0 / P1 验收门槛

### P0

- Hermes Service Identity 与 User Identity 分离。
- `channel_user_id` 来自已验证渠道事件，而不是普通 Header。
- Terra 验证签名 User Assertion、时效、nonce、Session 和 owner 映射。
- BM25、LanceDB、实体、关系、摘要和 Rerank 缓存均被分类为敏感派生数据。
- BM25 不产生未保护明文独立文件。
- LanceDB 不保存正文和凭证。
- `secret` 不进入远程模型和默认持久化 LanceDB。
- 备份数据与解密密钥分离。

### P1

- Task Queue 支持 Lease、Heartbeat、Worker 崩溃恢复和幂等。
- Approval 状态转移使用原子条件更新。
- Hybrid Search 使用明确的 Weighted RRF 和归一化规则。
- Answer 输出 Claim -> Evidence 结构，并通过服务端验证。
- Revision、Index、Evidence 都绑定 Content Hash。
- 权限判定使用 Tool、Data、Grant、Execution Mode 四维约束。

## 19. 修订后的结论

P0 是实现前不可模糊处理的安全边界；P1 是首版必须实现或提供可验证降级行为的基础设施约束。它们不改变模块化单体方案、三种执行模式、Hybrid Search、MCP 或 Hermes 的总体设计，而是将身份、安全、可靠性、一致性和授权规则从概念要求细化为可实现、可测试的契约。
