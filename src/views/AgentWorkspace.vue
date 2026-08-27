<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  Bot,
  Plus,
  MessageSquare,
  Trash2,
  SlidersHorizontal,
  ChevronRight,
  Eraser,
  Sparkles,
  BookOpen,
  Phone,
  ListChecks,
  Brain,
  ArrowUp,
  Square,
  Pin,
  PinOff,
  MoreVertical,
  Pencil
} from 'lucide-vue-next'
import { useModelProviders } from '../composables/useModelProviders'
import { useUserMemory } from '../composables/useUserMemory'
import { executeAgentChat, type ChatMessage } from '../services/aiAgentService'
import ModelProviderModal from '../components/ai/ModelProviderModal.vue'
import UserMemoryModal from '../components/ai/UserMemoryModal.vue'
import NoteCitationCard from '../components/ai/NoteCitationCard.vue'
import TodoActionCard from '../components/ai/TodoActionCard.vue'
import MarkdownRenderer from '../components/ai/MarkdownRenderer.vue'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'

interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  pinned?: boolean
}

const SESSIONS_STORAGE_KEY = 'synyflow_agent_sessions_v1'
const { activeProvider } = useModelProviders()
const { memories } = useUserMemory()

const sessions = ref<ChatSession[]>([])
const currentSessionId = ref<string>('')
const inputQuery = ref('')
const isGenerating = ref(false)
const showProviderModal = ref(false)
const showMemoryModal = ref(false)
const toastMessage = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
let abortController: AbortController | null = null

// 重命名状态
const editingSessionId = ref<string | null>(null)
const editingTitle = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

// 排序后的会话列表（置顶排在最前，其次按更新时间倒序）
const sortedSessions = computed(() => {
  return [...sessions.value].sort((a, b) => {
    const aPin = a.pinned ? 1 : 0
    const bPin = b.pinned ? 1 : 0
    if (bPin !== aPin) return bPin - aPin
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  })
})

const currentSession = computed(() => {
  return sessions.value.find((s) => s.id === currentSessionId.value) || null
})

const currentMessages = computed(() => {
  return currentSession.value?.messages || []
})

const presetPrompts = [
  { icon: BookOpen, label: '总结文学/小说的文案笔记', prompt: '请帮我总结并提炼我笔记中关于文学或小说的优美文案与经典金句。' },
  { icon: Phone, label: '查找笔记中的手机号码', prompt: '我有哪些出现了手机号的笔记？请帮我整理出来。' },
  { icon: ListChecks, label: '提取近期待办计划', prompt: '请查看我近期的笔记，帮我梳理并提取出需要执行的待办事项。' },
  { icon: Brain, label: '分析近期笔记主题', prompt: '请分析我最近记录的笔记主要集中在哪些主题和领域？' }
]

onMounted(() => {
  loadSessions()
  ensureScrollToBottom()
})

function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY)
    if (raw) {
      sessions.value = JSON.parse(raw)
    }
  } catch {
    sessions.value = []
  }

  if (!sessions.value.length) {
    createNewSession()
  } else {
    // 默认选择第一个（可能是置顶的）
    currentSessionId.value = sortedSessions.value[0]?.id || sessions.value[0].id
  }
}

function persistSessions() {
  localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions.value))
}

function createNewSession() {
  const newSession: ChatSession = {
    id: 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title: '新的对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false
  }
  sessions.value.unshift(newSession)
  currentSessionId.value = newSession.id
  persistSessions()
  ensureScrollToBottom()
}

function switchSession(id: string) {
  if (editingSessionId.value === id) return
  if (isGenerating.value) handleStop()
  currentSessionId.value = id
  ensureScrollToBottom()
}

function togglePinSession(id: string) {
  const target = sessions.value.find((s) => s.id === id)
  if (!target) return
  target.pinned = !target.pinned
  target.updatedAt = Date.now()
  persistSessions()
  showToast(target.pinned ? '已置顶对话' : '已取消置顶')
}

function startRename(s: ChatSession) {
  editingSessionId.value = s.id
  editingTitle.value = s.title
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

function saveRename(id: string) {
  if (!editingSessionId.value) return
  const target = sessions.value.find((s) => s.id === id)
  const trimmed = editingTitle.value.trim()
  if (target && trimmed) {
    target.title = trimmed
    target.updatedAt = Date.now()
    persistSessions()
  }
  editingSessionId.value = null
  editingTitle.value = ''
}

function cancelRename() {
  editingSessionId.value = null
  editingTitle.value = ''
}

function deleteSession(id: string) {
  if (sessions.value.length <= 1) {
    // 重置当前唯一会话
    if (currentSession.value) {
      currentSession.value.messages = []
      currentSession.value.title = '新的对话'
      currentSession.value.pinned = false
      persistSessions()
      showToast('已重置对话内容')
    }
    return
  }
  sessions.value = sessions.value.filter((s) => s.id !== id)
  if (currentSessionId.value === id) {
    currentSessionId.value = sortedSessions.value[0]?.id || sessions.value[0]?.id || ''
  }
  persistSessions()
  ensureScrollToBottom()
  showToast('已删除对话')
}

function clearCurrentSession() {
  if (!currentSession.value) return
  if (isGenerating.value) handleStop()
  currentSession.value.messages = []
  persistSessions()
  showToast('已清空当前会话')
}

function scrollToBottom(behavior: ScrollBehavior = 'auto') {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTo({
        top: messagesContainer.value.scrollHeight,
        behavior
      })
    }
  })
}

// 解决 Markdown / LaTeX / 卡片异步撑开高度后的二次与三次微校准
function ensureScrollToBottom(behavior: ScrollBehavior = 'auto') {
  scrollToBottom(behavior)
  setTimeout(() => scrollToBottom(behavior), 60)
  setTimeout(() => scrollToBottom(behavior), 180)
}

function showToast(msg: string) {
  toastMessage.value = msg
  setTimeout(() => {
    if (toastMessage.value === msg) toastMessage.value = ''
  }, 2500)
}

// 动态调整 Textarea 高度
function handleTextareaInput() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  const targetHeight = Math.min(el.scrollHeight, 160)
  el.style.height = `${Math.max(38, targetHeight)}px`
}

function resetTextareaHeight() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = '38px'
}

// 高性能打字机平滑流式输出控制器
class SmoothStreamWriter {
  private queue = ''
  private isTicking = false
  private timer: number | null = null
  private onWrite: (text: string) => void
  private current = ''
  private onFinish?: () => void

  constructor(onWrite: (text: string) => void, onFinish?: () => void) {
    this.onWrite = onWrite
    this.onFinish = onFinish
  }

  write(chunk: string) {
    this.queue += chunk
    if (!this.isTicking) {
      this.start()
    }
  }

  private start() {
    this.isTicking = true
    const tick = () => {
      if (!this.queue.length) {
        this.isTicking = false
        this.timer = null
        this.onFinish?.()
        return
      }

      // 自适应吐字算法：保证生动打字机节奏感，积压时自适应加速
      const qLen = this.queue.length
      let step = 1
      if (qLen > 200) step = Math.min(18, Math.ceil(qLen / 8))
      else if (qLen > 80) step = Math.min(7, Math.ceil(qLen / 10))
      else if (qLen > 30) step = 3
      else if (qLen > 10) step = 2
      else step = 1

      const toAdd = this.queue.slice(0, step)
      this.queue = this.queue.slice(step)
      this.current += toAdd
      this.onWrite(this.current)

      this.timer = window.setTimeout(tick, 14)
    }
    tick()
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.queue.length > 0) {
      this.current += this.queue
      this.queue = ''
      this.onWrite(this.current)
    }
    this.isTicking = false
    this.onFinish?.()
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.queue = ''
    this.isTicking = false
  }

  get isBusy() {
    return this.isTicking || this.queue.length > 0
  }
}

let activeContentWriter: SmoothStreamWriter | null = null
let activeReasoningWriter: SmoothStreamWriter | null = null

async function handleSend(textOverride?: string) {
  const query = (textOverride || inputQuery.value).trim()
  if (!query || isGenerating.value || !currentSession.value) return
  if (!activeProvider.value) {
    showProviderModal.value = true
    return
  }

  inputQuery.value = ''
  nextTick(() => resetTextareaHeight())

  // 1. 追加用户消息
  const userMsg: ChatMessage = {
    id: 'msg_' + Date.now(),
    role: 'user',
    content: query,
    createdAt: Date.now()
  }
  currentSession.value.messages.push(userMsg)

  // 更新会话标题（首条消息）
  if (currentSession.value.messages.length === 1 || currentSession.value.title === '新的对话') {
    currentSession.value.title = query.slice(0, 16)
  }

  // 2. 创建 Assistant 占位消息并推入响应式数组
  const assistantMsgId = 'msg_' + (Date.now() + 1)
  const assistantMsg: ChatMessage = {
    id: assistantMsgId,
    role: 'assistant',
    content: '',
    reasoningContent: '',
    toolCallStatus: { type: 'search', text: '正在分析意图...', active: true },
    createdAt: Date.now()
  }
  currentSession.value.messages.push(assistantMsg)
  currentSession.value.updatedAt = Date.now()
  persistSessions()
  scrollToBottom()

  // 安全获取响应式代理对象修改器，保证每一次变更都能 100% 触发 Vue 响应式更新
  const updateAssistantProxy = (updater: (target: ChatMessage) => void) => {
    const list = currentSession.value?.messages
    if (!list) return
    const target = list.find((m) => m.id === assistantMsgId)
    if (target) {
      updater(target)
    }
  }

  // 初始化正文与思考流平滑打字机
  activeContentWriter = new SmoothStreamWriter(
    (text) => {
      updateAssistantProxy((msg) => {
        if (msg.toolCallStatus?.active) {
          msg.toolCallStatus.active = false
        }
        msg.content = text
      })
      scrollToBottom()
    },
    () => {
      persistSessions()
      scrollToBottom()
    }
  )

  activeReasoningWriter = new SmoothStreamWriter(
    (text) => {
      updateAssistantProxy((msg) => {
        if (msg.toolCallStatus?.active) {
          msg.toolCallStatus.active = false
        }
        msg.reasoningContent = text
      })
      scrollToBottom()
    }
  )

  // 3. 执行流式对话
  isGenerating.value = true
  abortController = new AbortController()

  try {
    await executeAgentChat({
      provider: activeProvider.value,
      messages: currentSession.value.messages
        .filter((m) => m.id !== assistantMsgId)
        .map((m) => ({ role: m.role, content: m.content })),
      signal: abortController.signal,
      onStatus: (status) => {
        updateAssistantProxy((msg) => {
          if (msg.toolCallStatus) {
            msg.toolCallStatus.text = status
            msg.toolCallStatus.active = true
          }
        })
        scrollToBottom()
      },
      onCitations: (citations) => {
        updateAssistantProxy((msg) => {
          msg.citations = citations
        })
        ensureScrollToBottom()
      },
      onReasoning: (chunk) => {
        updateAssistantProxy((msg) => {
          if (msg.toolCallStatus?.active) {
            msg.toolCallStatus.active = false
          }
        })
        activeReasoningWriter?.write(chunk)
      },
      onChunk: (chunk) => {
        updateAssistantProxy((msg) => {
          if (msg.toolCallStatus?.active) {
            msg.toolCallStatus.active = false
          }
        })
        activeContentWriter?.write(chunk)
      },
      onTodoAction: (action) => {
        updateAssistantProxy((msg) => {
          msg.todoAction = action
        })
        ensureScrollToBottom()
      }
    })
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      activeContentWriter?.write(`\n\n❌ **请求中断或出错**：${err.message || err}`)
    }
  } finally {
    updateAssistantProxy((msg) => {
      if (msg.toolCallStatus) {
        msg.toolCallStatus.active = false
      }
    })
    // 等待平滑打字流完全排空吐完
    const waitForWriter = () => {
      if (activeContentWriter?.isBusy || activeReasoningWriter?.isBusy) {
        setTimeout(waitForWriter, 40)
      } else {
        isGenerating.value = false
        abortController = null
        persistSessions()
        ensureScrollToBottom()
      }
    }
    waitForWriter()
  }
}

function handleStop() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  activeContentWriter?.flush()
  activeReasoningWriter?.flush()
  isGenerating.value = false
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="flex h-screen w-full overflow-hidden bg-background">
    <!-- 左侧会话侧边栏 -->
    <aside class="flex w-64 flex-shrink-0 flex-col border-r border-outline-variant/20 bg-surface-container-low/40">
      <!-- 头部：标题与新建按钮 -->
      <div class="flex items-center justify-between border-b border-outline-variant/15 p-3.5">
        <div class="flex items-center gap-2">
          <div class="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot class="h-4 w-4" :stroke-width="2" />
          </div>
          <span class="font-headline text-sm font-bold text-on-surface">AI 助手</span>
        </div>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-lg border border-outline-variant/30 text-secondary hover:border-primary hover:bg-surface-container-high hover:text-primary transition active:scale-95"
          @click="createNewSession"
          title="新建对话"
        >
          <Plus class="h-4 w-4" :stroke-width="2" />
        </button>
      </div>

      <!-- 会话列表（固定单项高度，无抖动，支持置顶/更多菜单与右键） -->
      <div class="flex-1 space-y-1 overflow-y-auto p-2">
        <ContextMenu v-for="s in sortedSessions" :key="s.id">
          <ContextMenuTrigger as-child>
            <div
              class="group relative flex h-10 w-full cursor-pointer items-center justify-between rounded-xl px-2.5 transition-colors duration-150 text-left select-none"
              :class="[
                s.id === currentSessionId
                  ? 'bg-surface-container-lowest text-primary shadow-xs ring-1 ring-primary/20 font-bold'
                  : 'text-on-surface hover:bg-surface-container'
              ]"
              @click="switchSession(s.id)"
            >
              <!-- 正常标题展示 -->
              <div v-if="editingSessionId !== s.id" class="flex min-w-0 items-center gap-2 flex-1 mr-1">
                <!-- 置顶标记小图标 或 默认对话图标 -->
                <Pin v-if="s.pinned" class="h-3.5 w-3.5 text-primary flex-shrink-0" :stroke-width="2.2" />
                <MessageSquare v-else class="h-3.5 w-3.5 opacity-60 flex-shrink-0" :stroke-width="1.8" />
                
                <span class="truncate text-xs leading-none">{{ s.title }}</span>
              </div>

              <!-- 内联重命名输入框 -->
              <div v-else class="flex items-center flex-1 mr-1" @click.stop>
                <input
                  ref="renameInputRef"
                  v-model="editingTitle"
                  type="text"
                  class="w-full rounded-md border border-primary bg-surface-container-lowest px-1.5 py-0.5 text-xs text-on-surface outline-none"
                  @keydown.enter="saveRename(s.id)"
                  @keydown.esc="cancelRename"
                  @blur="saveRename(s.id)"
                />
              </div>

              <!-- 悬停操作按钮组（恒定尺寸布局，零物理抖动） -->
              <div
                v-if="editingSessionId !== s.id"
                class="flex items-center gap-0.5 flex-shrink-0 transition-opacity duration-150"
                :class="[
                  s.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                ]"
                @click.stop
              >
                <!-- 置顶图标按钮 -->
                <button
                  class="flex h-6 w-6 items-center justify-center rounded-md text-secondary hover:bg-surface-container-high hover:text-primary transition"
                  :class="{ 'text-primary': s.pinned }"
                  :title="s.pinned ? '取消置顶' : '置顶对话'"
                  @click.stop="togglePinSession(s.id)"
                >
                  <Pin v-if="s.pinned" class="h-3.5 w-3.5 fill-current" />
                  <Pin v-else class="h-3.5 w-3.5" :stroke-width="1.8" />
                </button>

                <!-- 更多操作下拉菜单 -->
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <button
                      class="flex h-6 w-6 items-center justify-center rounded-md text-secondary hover:bg-surface-container-high hover:text-primary transition"
                      title="更多操作"
                      @click.stop
                    >
                      <MoreVertical class="h-3.5 w-3.5" :stroke-width="1.8" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-36">
                    <DropdownMenuItem @select="startRename(s)">
                      <Pencil class="h-3.5 w-3.5 text-secondary" :stroke-width="1.8" />
                      <span>重命名</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem @select="togglePinSession(s.id)">
                      <component :is="s.pinned ? PinOff : Pin" class="h-3.5 w-3.5 text-secondary" :stroke-width="1.8" />
                      <span>{{ s.pinned ? '取消置顶' : '置顶对话' }}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem @select="deleteSession(s.id)" class="text-error data-[highlighted]:!bg-error/10 data-[highlighted]:!text-error">
                      <Trash2 class="h-3.5 w-3.5 text-error" :stroke-width="1.8" />
                      <span>删除</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </ContextMenuTrigger>

          <!-- 右键上下文菜单 -->
          <ContextMenuContent class="w-36">
            <ContextMenuItem @select="startRename(s)">
              <Pencil class="h-3.5 w-3.5 text-secondary" :stroke-width="1.8" />
              <span>重命名</span>
            </ContextMenuItem>
            <ContextMenuItem @select="togglePinSession(s.id)">
              <component :is="s.pinned ? PinOff : Pin" class="h-3.5 w-3.5 text-secondary" :stroke-width="1.8" />
              <span>{{ s.pinned ? '取消置顶' : '置顶对话' }}</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem @select="deleteSession(s.id)" class="text-error data-[highlighted]:!bg-error/10 data-[highlighted]:!text-error">
              <Trash2 class="h-3.5 w-3.5 text-error" :stroke-width="1.8" />
              <span>删除</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      <!-- 底部配置快捷入口 -->
      <div class="border-t border-outline-variant/15 p-3">
        <button
          class="flex w-full items-center justify-between rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-2.5 text-xs text-on-surface hover:border-primary/40 hover:bg-surface-container transition"
          @click="showProviderModal = true"
        >
          <div class="flex min-w-0 items-center gap-2">
            <SlidersHorizontal class="h-4 w-4 text-primary flex-shrink-0" :stroke-width="2" />
            <div class="min-w-0 text-left">
              <p class="truncate text-[11px] font-bold">{{ activeProvider?.name || '未设置供应商' }}</p>
              <p class="truncate text-[10px] text-secondary">{{ activeProvider?.selectedModel || '点击配置 API Key' }}</p>
            </div>
          </div>
          <ChevronRight class="h-4 w-4 text-secondary flex-shrink-0" :stroke-width="2" />
        </button>
      </div>
    </aside>

    <!-- 中间核心 Chat 工作区 -->
    <main class="flex flex-1 flex-col overflow-hidden bg-background">
      <!-- 顶部控制条 -->
      <header class="flex h-14 flex-shrink-0 items-center justify-between border-b border-outline-variant/15 bg-surface/60 px-6 backdrop-blur-md">
        <div class="flex items-center gap-3">
          <h2 class="font-headline text-sm font-bold text-on-surface truncate max-w-md">
            {{ currentSession?.title || 'synyFlow AI 助手' }}
          </h2>
        </div>

        <div class="flex items-center gap-2">
          <!-- 记忆库快捷入口 -->
          <button
            class="flex items-center gap-1.5 rounded-xl border border-outline-variant/30 bg-surface-container px-3 py-1.5 text-xs font-bold text-on-surface hover:bg-surface-container-high transition"
            @click="showMemoryModal = true"
            title="查看和管理 AI 记住的个人偏好与事实"
          >
            <Brain class="h-3.5 w-3.5 text-primary" :stroke-width="2" />
            <span>记忆库</span>
            <span
              v-if="memories.length"
              class="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] text-primary font-mono font-bold"
            >
              {{ memories.length }}
            </span>
          </button>

          <!-- 切换模型快捷胶囊 -->
          <button
            class="flex items-center gap-1.5 rounded-xl border border-outline-variant/30 bg-surface-container px-3 py-1.5 text-xs font-bold text-on-surface hover:bg-surface-container-high transition"
            @click="showProviderModal = true"
          >
            <span
              class="h-2 w-2 rounded-full flex-shrink-0"
              :class="activeProvider?.apiKey ? 'bg-primary' : 'bg-error animate-pulse'"
            ></span>
            <span>{{ activeProvider?.name || '模型管理' }}</span>
            <span v-if="activeProvider?.selectedModel" class="font-mono text-[10px] text-secondary">
              · {{ activeProvider.selectedModel }}
            </span>
            <SlidersHorizontal class="h-3.5 w-3.5 text-secondary" :stroke-width="2" />
          </button>

          <button
            class="flex h-8 w-8 items-center justify-center rounded-xl text-secondary hover:bg-surface-container hover:text-error transition"
            @click="clearCurrentSession"
            title="清空当前会话上下文"
          >
            <Eraser class="h-4 w-4" :stroke-width="1.85" />
          </button>
        </div>
      </header>

      <!-- 消息流容器 -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-6 sm:px-12 md:px-20 lg:px-32 space-y-6">
        <!-- 空状态：欢迎与预设 Prompt -->
        <div v-if="!currentMessages.length" class="flex min-h-[60vh] flex-col items-center justify-center text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm mb-4">
            <Sparkles class="h-8 w-8 text-primary" :stroke-width="1.75" />
          </div>
          <h3 class="font-headline text-2xl font-bold text-on-surface tracking-tight">你好，我是 synyFlow AI 助手</h3>
          <p class="mt-2 max-w-md text-xs sm:text-sm text-secondary leading-relaxed font-body">
            我可以基于你的小米笔记知识库进行深度检索、文学文案总结，并能直接将对话中的行动项一键转化为 Todo。
          </p>

          <!-- 预设 Prompt 卡片 -->
          <div class="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            <div
              v-for="(item, idx) in presetPrompts"
              :key="idx"
              class="flex cursor-pointer items-start gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3.5 text-left transition hover:border-primary/40 hover:bg-surface-container hover:shadow-sm"
              @click="handleSend(item.prompt)"
            >
              <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-secondary-container text-on-secondary-container">
                <component :is="item.icon" class="h-4 w-4" :stroke-width="2" />
              </div>
              <div class="min-w-0 flex-1">
                <h4 class="text-xs font-bold text-on-surface font-headline">{{ item.label }}</h4>
                <p class="mt-0.5 line-clamp-1 text-[11px] text-secondary font-body">{{ item.prompt }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 对话流气泡 -->
        <div v-for="msg in currentMessages" :key="msg.id" class="flex flex-col space-y-2">
          <!-- 用户提问 -->
          <div v-if="msg.role === 'user'" class="flex justify-end items-start gap-3 pl-12">
            <div class="max-w-[85%] rounded-2xl rounded-tr-xs bg-primary px-4 py-2.5 text-[13px] sm:text-sm leading-relaxed text-on-primary shadow-xs font-body whitespace-pre-wrap">
              {{ msg.content }}
            </div>
            <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container text-xs font-bold shadow-xs">
              👤
            </div>
          </div>

          <!-- Assistant 回复 -->
          <div v-else class="flex justify-start items-start gap-3 pr-12">
            <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary mt-0.5 shadow-xs">
              <Bot class="h-4 w-4" :stroke-width="2" />
            </div>

            <div class="min-w-0 flex-1 space-y-3">
              <!-- 工具调用状态胶囊 -->
              <div
                v-if="msg.toolCallStatus?.text"
                class="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container-high/60 px-3 py-1 text-[11px] text-secondary select-none font-body"
              >
                <span v-if="msg.toolCallStatus.active" class="animate-spin text-[11px]">⏳</span>
                <span>{{ msg.toolCallStatus.text }}</span>
              </div>

              <!-- 思考过程折叠块 (DeepSeek R1 等推理流) -->
              <div
                v-if="msg.reasoningContent"
                class="rounded-xl border border-outline-variant/20 bg-surface-container-low/50 p-3.5 text-xs text-secondary font-mono leading-relaxed"
              >
                <div class="mb-1.5 flex items-center gap-1.5 font-bold text-on-surface-variant/80">
                  <Brain class="h-3.5 w-3.5 text-primary" :stroke-width="2" />
                  <span>深度思考过程</span>
                </div>
                <div class="whitespace-pre-wrap text-[11px] opacity-80 font-mono">{{ msg.reasoningContent }}</div>
              </div>

              <!-- 正文内容 (Markdown + LaTeX 排版渲染) -->
              <div
                v-if="msg.content || (!msg.reasoningContent && msg.toolCallStatus?.active)"
                class="rounded-2xl rounded-tl-xs border border-outline-variant/25 bg-surface-container-lowest p-4 sm:p-5 shadow-xs"
              >
                <div v-if="!msg.content && msg.toolCallStatus?.active" class="flex items-center gap-2 text-xs text-secondary italic">
                  <span class="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span>
                  <span>{{ msg.toolCallStatus?.text || 'AI 助手正在构思回答...' }}</span>
                </div>
                <MarkdownRenderer
                  v-else
                  :content="msg.content"
                  :is-streaming="isGenerating && msg.id === currentMessages[currentMessages.length - 1]?.id"
                />
              </div>

              <!-- 笔记引用卡片（在当前消息输出完毕后才优雅呈现，避免生成前喧宾夺主） -->
              <Transition name="fade-slide">
                <div
                  v-if="msg.citations?.length && (!isGenerating || msg.id !== currentMessages[currentMessages.length - 1]?.id)"
                  class="space-y-1.5 pt-1"
                >
                  <div class="flex items-center gap-1 text-[11px] font-bold text-secondary">
                    <BookOpen class="h-3.5 w-3.5" :stroke-width="2" />
                    <span>参考知识库笔记来源 ({{ msg.citations.length }})：</span>
                  </div>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <NoteCitationCard
                      v-for="(citation, cIdx) in msg.citations"
                      :key="cIdx"
                      :citation="citation"
                    />
                  </div>
                </div>
              </Transition>

              <!-- 待办提取行动建议卡片（在流式输出完毕后展示） -->
              <Transition name="fade-slide">
                <TodoActionCard
                  v-if="msg.todoAction && (!isGenerating || msg.id !== currentMessages[currentMessages.length - 1]?.id)"
                  :action="msg.todoAction"
                  @added="(count) => showToast(`已将 ${count} 条待办同步至 Todo 列表！`)"
                />
              </Transition>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部输入控制条 -->
      <footer class="border-t border-outline-variant/15 bg-surface/80 p-4 sm:px-12 md:px-20 lg:px-32 backdrop-blur-md">
        <!-- 快捷小标签 -->
        <div class="mb-2 flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <button
            v-for="(item, idx) in presetPrompts"
            :key="idx"
            class="flex flex-shrink-0 items-center gap-1 rounded-lg border border-outline-variant/25 bg-surface-container px-2.5 py-1 text-[11px] font-medium text-secondary hover:border-primary/30 hover:bg-surface-container-high hover:text-primary transition"
            @click="handleSend(item.prompt)"
          >
            <span>{{ item.label }}</span>
          </button>
        </div>

        <!-- 输入框容器：消除双重边框，动态高度自适应 -->
        <div class="relative flex items-end gap-2 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-2 shadow-xs transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
          <textarea
            ref="textareaRef"
            v-model="inputQuery"
            rows="1"
            placeholder="问点什么，或让 AI 助手提炼文案、搜索笔记、规划日程... (Enter 发送, Shift+Enter 换行)"
            class="flex-1 resize-none border-0 border-none bg-transparent px-2.5 py-1.5 text-xs font-normal leading-relaxed text-on-surface placeholder:text-on-surface-variant/40 shadow-none outline-none focus:border-0 focus:border-none focus:outline-none focus:ring-0 focus:shadow-none min-h-[38px] max-h-[160px] overflow-y-auto"
            :disabled="isGenerating"
            @input="handleTextareaInput"
            @keydown="handleKeyDown"
          ></textarea>

          <button
            v-if="!isGenerating"
            class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary shadow-xs hover:opacity-90 transition active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
            :disabled="!inputQuery.trim()"
            @click="handleSend()"
            title="发送消息"
          >
            <ArrowUp class="h-4 w-4" :stroke-width="2.5" />
          </button>
          <button
            v-else
            class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-error text-on-error shadow-xs hover:opacity-90 transition active:scale-95"
            @click="handleStop"
            title="停止生成"
          >
            <Square class="h-3.5 w-3.5 fill-current" />
          </button>
        </div>
      </footer>
    </main>

    <!-- 模型配置弹窗 -->
    <ModelProviderModal
      :open="showProviderModal"
      @close="showProviderModal = false"
      @selected="() => showToast('模型配置已切换')"
    />

    <!-- 长期记忆库管理弹窗 -->
    <UserMemoryModal
      v-model:open="showMemoryModal"
    />

    <!-- 全局 Toast -->
    <Transition name="toast">
      <div
        v-if="toastMessage"
        class="fixed left-1/2 top-6 z-[1000] -translate-x-1/2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-on-primary shadow-xl"
      >
        {{ toastMessage }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-slide-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.fade-slide-leave-active {
  transition: all 0.2s ease-out;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
</style>
