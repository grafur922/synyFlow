import type { ModelProviderProfile } from '../composables/useModelProviders'
import { agentToolRegistry, getAllToolDeclarations } from './agentTools'
import { useUserMemory } from '../composables/useUserMemory'

export interface TodoActionItem {
  title: string
  date?: string
  priority?: 'Low' | 'Medium' | 'High'
  category?: string
  notes?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  reasoningContent?: string
  toolCallStatus?: {
    type: 'search' | 'rerank' | 'action'
    text: string
    active?: boolean
  }
  citations?: Array<{
    number?: number
    documentId: string
    documentTitle: string
    heading?: string
    excerpt?: string
    score?: number
    updatedAt?: number
  }>
  todoAction?: {
    title: string
    todos: TodoActionItem[]
  }
  createdAt: number
}

export interface StreamChatOptions {
  provider: ModelProviderProfile
  messages: Array<{ role: string; content: string }>
  onStatus?: (status: string) => void
  onCitations?: (citations: ChatMessage['citations']) => void
  onReasoning?: (reasoningChunk: string) => void
  onChunk: (chunk: string) => void
  onTodoAction?: (action: ChatMessage['todoAction']) => void
  signal?: AbortSignal
}

function formatCurrentDateTime(): string {
  const now = new Date()
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  const weekday = weekdays[now.getDay()]
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${weekday}`
}

function buildSystemPrompt(): string {
  const currentDateTimeStr = formatCurrentDateTime()
  const memoryPrompt = useUserMemory().formatMemoriesForPrompt()

  return `你是 synyFlow 个人超级工作站的顶级 AI 助手与全能智能管家。
你的职责是协助用户管理笔记知识库、日程待办规划、文学文案提炼，并通过工具调用执行真实任务。

【当前系统基准时间】：${currentDateTimeStr}
${memoryPrompt ? `\n${memoryPrompt}\n` : ''}

【核心能力与工具调用原则】：
1. **按需使用工具**：你拥有丰富的工具集（搜索笔记、查询待办、创建待办、记录用户偏好）。当用户需要查找知识库、查询/创建待办日程时，请主动调用对应的工具完成任务。
2. **多步自主规划 (ReAct)**：当遇到复合任务（例如“帮我看看明天有空没，如果有空帮我安排一个下午游泳的待办”）时，请按步骤自主规划：先调用工具查询日程，拿到结果后综合判断，再调用工具创建日程，最后清晰总结汇报给用户。
3. **真实性与严谨性**：回答基于工具返回的真实数据或记忆，不要凭空捏造不存在的事实或笔记。
4. **文笔与排版**：总结文学文案、金句、随笔时，文笔优美、结构清晰（善用 Markdown 标题、列表、引用块）。
5. **记忆感知**：当用户明确告诉你他的生活习惯、个人喜好或重要事实时，主动调用 save_user_memory 工具沉淀为长期记忆。
`
}

export async function executeAgentChat(options: StreamChatOptions): Promise<string> {
  const { provider, messages, onStatus, onCitations, onReasoning, onChunk, onTodoAction, signal } = options

  const cleanBaseUrl = provider.baseUrl.trim().replace(/\/+$/, '')
  const apiKey = provider.apiKey.trim()

  if (!apiKey && provider.id !== 'local-ollama') {
    onChunk('⚠️ **提示**：当前选中的供应商尚未配置 API Key。\n\n请点击右上角【模型管理】设置您的 API Key 后即可开启全功能对话。')
    return ''
  }

  // 构建对话上下文，System Prompt 置顶
  const conversationMessages: any[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...messages.map((m) => ({ role: m.role, content: m.content }))
  ]

  const tools = getAllToolDeclarations()
  let fullAccumulatedResponse = ''
  let iteration = 0
  const MAX_ITERATIONS = 5 // 最大安全决策步数

  while (iteration < MAX_ITERATIONS) {
    iteration++
    onStatus?.(`🤖 ${provider.name} 正在思考分析...`)

    const requestBody: any = {
      model: provider.selectedModel || 'gpt-4o-mini',
      messages: conversationMessages,
      temperature: 0.7,
      stream: true
    }

    // 注入可用工具
    if (tools.length > 0) {
      requestBody.tools = tools
      requestBody.tool_choice = 'auto'
    }

    const res = await fetch(`${cleanBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`模型接口调用失败 (${res.status}): ${errText.slice(0, 300)}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('无法读取模型流式响应流')

    const decoder = new TextDecoder()
    let buffer = ''
    let roundContent = ''
    let isReasoningActive = false

    // 累积 tool_calls
    const roundToolCallsMap = new Map<number, {
      id: string
      name: string
      arguments: string
    }>()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const choice = parsed.choices?.[0]
            if (!choice) continue

            const delta = choice.delta

            // 1. 思考链内容 (如 DeepSeek R1 / 通义开源 reasoning_content)
            if (delta?.reasoning_content) {
              isReasoningActive = true
              onReasoning?.(delta.reasoning_content)
            }

            // 2. 正常文本输出
            if (delta?.content) {
              if (isReasoningActive) {
                isReasoningActive = false
              }
              roundContent += delta.content
              fullAccumulatedResponse += delta.content
              onChunk(delta.content)
            }

            // 3. Tool Calls 输出（流式拼接片段）
            if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0
                const current = roundToolCallsMap.get(index) || { id: '', name: '', arguments: '' }
                if (tc.id) current.id = tc.id
                if (tc.function?.name) current.name += tc.function.name
                if (tc.function?.arguments) current.arguments += tc.function.arguments
                roundToolCallsMap.set(index, current)
              }
            }
          } catch {
            // 忽略单行 JSON 解析错误
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    const toolCalls = Array.from(roundToolCallsMap.values()).filter((t) => t.name)

    // 如果本轮模型没有发起任何工具调用，说明已得到最终回复，退出循环
    if (!toolCalls.length) {
      break
    }

    // 将 Assistant 包含 tool_calls 的消息放入历史
    conversationMessages.push({
      role: 'assistant',
      content: roundContent || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id || `call_${Date.now()}`,
        type: 'function',
        function: {
          name: tc.name,
          arguments: tc.arguments
        }
      }))
    })

    // 执行所有被调用的工具
    for (const tc of toolCalls) {
      const handler = agentToolRegistry[tc.name]
      let toolResult: any = null

      if (!handler) {
        toolResult = { error: `未找到工具: ${tc.name}` }
      } else {
        let parsedArgs = {}
        try {
          parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {}
        } catch {
          parsedArgs = { query: tc.arguments }
        }

        try {
          toolResult = await handler.execute(parsedArgs, {
            onCitations,
            onStatus
          })
        } catch (err: any) {
          toolResult = { error: err.message || '工具执行出错' }
        }
      }

      // 将工具执行结果作为 tool 角色消息回填进对话上下文
      conversationMessages.push({
        role: 'tool',
        tool_call_id: tc.id || `call_${Date.now()}`,
        content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
      })
    }
  }

  // 尝试从回复中解析待办 JSON 建议（兼容展示卡片）
  try {
    const jsonMatch = fullAccumulatedResponse.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch && jsonMatch[1]) {
      const parsed = JSON.parse(jsonMatch[1])
      if (parsed?.action === 'create_todos' && Array.isArray(parsed.todos)) {
        onTodoAction?.({
          title: parsed.title || '从对话中提炼出的待办',
          todos: parsed.todos
        })
      }
    }
  } catch {
    // 忽略非待办 JSON 解析
  }

  return fullAccumulatedResponse
}
