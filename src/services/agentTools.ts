import { ragApi } from './ragApi'
import type { RagCitation } from '../shared/rag'
import { taskApi } from './taskApi'
import { useUserMemory } from '../composables/useUserMemory'

export interface AgentToolDeclaration {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
    }
  }
}

export interface ToolExecutionContext {
  onCitations?: (citations: Array<{
    number?: number
    documentId: string
    documentTitle: string
    heading?: string
    excerpt?: string
    score?: number
    updatedAt?: number
  }>) => void
  onStatus?: (status: string) => void
}

export interface AgentToolHandler {
  declaration: AgentToolDeclaration
  execute: (args: any, context?: ToolExecutionContext) => Promise<any>
}

// 1. 搜索小米笔记与知识库工具
const searchNotesTool: AgentToolHandler = {
  declaration: {
    type: 'function',
    function: {
      name: 'search_notes',
      description: '当用户的提问涉及查找笔记、过往记录、文学文案、手机号码、账号密码、历史随笔或具体知识点时调用此工具检索小米笔记知识库。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索关键词或搜索意图句子'
          },
          limit: {
            type: 'number',
            description: '返回结果数量上限，默认为 5'
          }
        },
        required: ['query']
      }
    }
  },
  execute: async (args: { query: string; limit?: number }, context?: ToolExecutionContext) => {
    const q = args.query.trim()
    if (!q) return { count: 0, results: [], message: '搜索关键词为空' }

    context?.onStatus?.(`🔍 正在检索知识库笔记: "${q}"...`)
    try {
      const res = await ragApi.query({
        query: q,
        limit: args.limit || 5,
        maxPrivacy: 'secret'
      })

      const citations = (res.citations || []).map((c: RagCitation) => ({
        number: c.number,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        heading: c.heading,
        excerpt: c.excerpt,
        score: c.score,
        updatedAt: c.updatedAt
      }))

      if (citations.length > 0) {
        context?.onCitations?.(citations)
        return {
          count: citations.length,
          notes: citations.map((c) => ({
            title: c.documentTitle,
            updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString().split('T')[0] : '未知',
            heading: c.heading,
            content: c.excerpt,
            score: c.score
          }))
        }
      } else {
        return { count: 0, notes: [], message: '知识库中未检索到直接相关的笔记' }
      }
    } catch (err: any) {
      return { count: 0, error: err.message || '知识库检索异常' }
    }
  }
}

// 2. 获取待办任务与日历日程工具
const getTasksTool: AgentToolHandler = {
  declaration: {
    type: 'function',
    function: {
      name: 'get_tasks',
      description: '查询用户已有或指定的待办事项与日程安排，可按具体日期（YYYY-MM-DD）或分类查询。',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: '可选，查询指定日期的待办/日程，格式必须为 YYYY-MM-DD'
          },
          category: {
            type: 'string',
            description: '可选，待办事项分类（如工作、生活、学习）'
          },
          includeCompleted: {
            type: 'boolean',
            description: '是否包含已完成的任务，默认为 false'
          }
        }
      }
    }
  },
  execute: async (args: { date?: string; category?: string; includeCompleted?: boolean }, context?: ToolExecutionContext) => {
    context?.onStatus?.(args.date ? `📅 正在查询 ${args.date} 的日程待办...` : '📋 正在获取待办清单...')
    try {
      const allTasks = await taskApi.getTasks()
      let filtered = allTasks
      if (!args.includeCompleted) {
        filtered = filtered.filter((t) => !t.completed)
      }
      if (args.date) {
        filtered = filtered.filter((t) => t.date === args.date)
      }
      if (args.category) {
        filtered = filtered.filter((t) => t.category.toLowerCase() === args.category!.toLowerCase())
      }

      return {
        total: filtered.length,
        queryDate: args.date || '全部',
        tasks: filtered.map((t) => ({
          id: t.id,
          title: t.title,
          date: t.date,
          time: t.timeStart ? `${t.timeStart}${t.timeEnd ? '-' + t.timeEnd : ''}` : '全天',
          category: t.category,
          priority: t.priority,
          completed: t.completed,
          notes: t.notes
        }))
      }
    } catch (err: any) {
      return { total: 0, error: err.message || '获取待办列表失败' }
    }
  }
}

// 3. 创建待办事项/日程工具
const createTaskTool: AgentToolHandler = {
  declaration: {
    type: 'function',
    function: {
      name: 'create_task',
      description: '为用户创建新的待办事项或日程计划。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '待办任务标题，简明扼要'
          },
          date: {
            type: 'string',
            description: '执行日期，格式为 YYYY-MM-DD（基于当前系统时间推算）'
          },
          timeStart: {
            type: 'string',
            description: '开始时间，格式为 HH:mm（如 15:00）'
          },
          timeEnd: {
            type: 'string',
            description: '结束时间，格式为 HH:mm（如 16:30）'
          },
          priority: {
            type: 'string',
            enum: ['Low', 'Medium', 'High'],
            description: '优先级，默认为 Medium'
          },
          category: {
            type: 'string',
            description: '任务分类（如 工作、生活、运动、学习），默认为 收集箱'
          },
          notes: {
            type: 'string',
            description: '备注或详细描述信息'
          }
        },
        required: ['title']
      }
    }
  },
  execute: async (args: {
    title: string
    date?: string
    timeStart?: string
    timeEnd?: string
    priority?: 'Low' | 'Medium' | 'High'
    category?: string
    notes?: string
  }, context?: ToolExecutionContext) => {
    context?.onStatus?.(`✍️ 正在创建待办: "${args.title}"...`)
    try {
      const todayStr = new Date().toISOString().split('T')[0]
      const created = await taskApi.createTask({
        title: args.title.trim(),
        date: args.date || todayStr,
        timeStart: args.timeStart || '',
        timeEnd: args.timeEnd || '',
        priority: args.priority || 'Medium',
        category: args.category || '收集箱',
        notes: args.notes || '',
        completed: false
      })

      return {
        success: true,
        message: `已成功创建待办：${created.title} (${created.date || '无日期'}${created.timeStart ? ' ' + created.timeStart : ''})`,
        task: created
      }
    } catch (err: any) {
      return { success: false, error: err.message || '创建待办失败' }
    }
  }
}

// 4. 保存用户长期偏好与事实记忆工具
const saveUserMemoryTool: AgentToolHandler = {
  declaration: {
    type: 'function',
    function: {
      name: 'save_user_memory',
      description: '当用户在对话中明确提及个人的生活习惯、偏好（如喜欢什么时候运动、常住城市、饮食作息习惯）或重要背景事实时调用此工具沉淀为长期记忆。',
      parameters: {
        type: 'object',
        properties: {
          fact: {
            type: 'string',
            description: '提炼出的一句话偏好或事实，如：用户习惯在下午安排游泳锻炼'
          },
          category: {
            type: 'string',
            enum: ['preference', 'fact', 'habit'],
            description: '分类：preference(偏好), fact(事实), habit(习惯)'
          }
        },
        required: ['fact']
      }
    }
  },
  execute: async (args: { fact: string; category?: 'preference' | 'fact' | 'habit' }, context?: ToolExecutionContext) => {
    const memory = useUserMemory()
    const item = memory.addMemory(args.fact, args.category || 'preference')
    context?.onStatus?.(`🧠 已记录你的偏好: "${args.fact}"`)
    return {
      success: Boolean(item),
      message: item ? `已成功保存记忆: ${args.fact}` : '记忆已存在，无需重复记录'
    }
  }
}

export const agentToolRegistry: Record<string, AgentToolHandler> = {
  search_notes: searchNotesTool,
  get_tasks: getTasksTool,
  create_task: createTaskTool,
  save_user_memory: saveUserMemoryTool
}

export function getAllToolDeclarations(): AgentToolDeclaration[] {
  return Object.values(agentToolRegistry).map((t) => t.declaration)
}
