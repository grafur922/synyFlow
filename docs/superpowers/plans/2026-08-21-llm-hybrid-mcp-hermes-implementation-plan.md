# synyFlow: LLM 智能助手、RAG 检索与 MCP 极简实施计划

> 基于规范：`docs/superpowers/specs/2026-08-15-llm-hybrid-mcp-hermes-design.md`  
> 核心目标：以清晰、可控、高质量的代码逐步打通 RAG 重排、MCP 接口以及前端 AI 交互。

---

## 阶段规划概览

```
[阶段 1: RAG 混合检索与 Rerank 增强]
        ↓
[阶段 2: 极简标准 MCP Server (Hermes / Claude 接口)]
        ↓
[阶段 3: 前端 AI 助手抽屉与交互质感]
```

---

## 阶段 1：RAG 混合检索与 Rerank 增强

### 1.1 目标
- 完善现有的混合检索逻辑，加入 Rerank（重排）支持（支持调用外部通用 Rerank API 如阿里云/通义，或本地降级排序）。
- 解决短文本（如“邮箱+手机号”）、无谓词备忘录的检索精度问题。

### 1.2 主要改动文件
- `server/src/rag/rerank.provider.ts`（新增：轻量 Rerank 客户端）
- `server/src/rag/rag.service.ts`（完善：在双路召回后插入 Rerank 环节）
- `server/src/rag/rag.controller.ts`（支持在检索接口中返回 Rerank 相关度得分）

### 1.3 验证标准
- 运行针对性测试：给定模拟数据（如 `xxx@xxx.com 182xxxxxxxx`），查询“我某某邮箱绑定的手机号是多少”，能够在检索结果中稳居第一名。

---

## 阶段 2：极简标准 MCP Server 模块

### 1.1 目标
- 在 NestJS 中构建轻量 MCP 服务端（支持 SSE / HTTP JSON-RPC 传输）。
- 暴露 4 个标准 Tools：
  1. `search_notes`（调用 RAG 混合检索）
  2. `read_note`（读取笔记正文）
  3. `create_todo`（创建待办）
  4. `list_todos`（查询待办）

### 1.2 主要改动文件
- `server/src/mcp/mcp.module.ts`（新增）
- `server/src/mcp/mcp.service.ts`（新增：协议解析与工具注册）
- `server/src/mcp/mcp.controller.ts`（新增：SSE / POST 接口供 Hermes 连接）

### 1.3 验证标准
- 使用标准 MCP 客户端或 Curl 模拟调用 `tools/list` 和 `tools/call`，验证 4 个工具正常响应。

---

## 阶段 3：前端 AI 助手交互与视觉体验

### 1.1 目标
- 发挥前端优势，在 Vue 3 桌面端中构建精致的 AI 侧边栏/抽屉。
- 支持自然语言搜索、流式打字输出、笔记引用卡片（点击快速定位笔记）、智能提取待办的交互确认卡片。

### 1.2 主要改动文件
- `src/components/ai/AiAssistantDrawer.vue`（新增）
- `src/components/ai/NoteCitationCard.vue`（新增）
- `src/components/ai/TodoPreviewCard.vue`（新增）
- `src/stores/ai.ts`（新增：对话与检索状态管理）

### 1.3 验证标准
- 前端交互丝滑流畅，支持一键将 AI 整理出的建议转换为本地 Todo。
