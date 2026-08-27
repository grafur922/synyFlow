import { ref, computed, markRaw } from 'vue'
import {
  Bot,
  CheckSquare,
  NotebookTabs,
  Search,
  Library,
  Rss,
  PenTool,
  Calendar,
  Compass,
  TrendingUp
} from 'lucide-vue-next'

export interface SidebarItemDefinition {
  key: string
  label: string
  mobileLabel: string
  description: string
  icon: any
  path: string
}

export const DEFAULT_SIDEBAR_ITEMS: SidebarItemDefinition[] = [
  { key: 'agent', label: 'AI 助手', mobileLabel: 'AI 助手', description: '智能助手、知识对话与任务协同', icon: markRaw(Bot), path: '/agent' },
  { key: 'todo', label: 'Todo', mobileLabel: 'Todo', description: '待办任务清单与工作台看板', icon: markRaw(CheckSquare), path: '/todo' },
  { key: 'xiaomi-notes', label: '小米笔记', mobileLabel: '笔记', description: '小米云笔记安全同步与写作', icon: markRaw(NotebookTabs), path: '/xiaomi-notes' },
  { key: 'search', label: '全局搜索', mobileLabel: '搜索', description: '全文混合检索与跨模块查找', icon: markRaw(Search), path: '/search' },
  { key: 'knowledge', label: '知识库', mobileLabel: '知识', description: '本地文档管理与 RAG 向量知识库', icon: markRaw(Library), path: '/knowledge' },
  { key: 'rss', label: 'RSS 订阅', mobileLabel: 'RSS', description: '订阅源抓取与资讯聚合阅读', icon: markRaw(Rss), path: '/rss' },
  { key: 'blog', label: '个人博客', mobileLabel: '博客', description: '文章创作、排版与发布中心', icon: markRaw(PenTool), path: '/blog' },
  { key: 'calendar', label: '日历', mobileLabel: '日历', description: '日程安排、时间线与事件提醒', icon: markRaw(Calendar), path: '/calendar' },
  { key: 'travel', label: '路线规划', mobileLabel: '规划', description: 'AI 智能行程制定与地点规划', icon: markRaw(Compass), path: '/travel' },
  { key: 'stats', label: '洞察', mobileLabel: '洞察', description: '生产力指标与使用统计分析', icon: markRaw(TrendingUp), path: '/stats' }
]

const ORDER_STORAGE_KEY = 'synyflow_sidebar_items_order'
const DISABLED_STORAGE_KEY = 'synyflow_sidebar_disabled_keys'

function loadSavedOrder(): SidebarItemDefinition[] {
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY)
    if (!raw) return [...DEFAULT_SIDEBAR_ITEMS]
    const keys: string[] = JSON.parse(raw)
    if (!Array.isArray(keys)) return [...DEFAULT_SIDEBAR_ITEMS]

    const itemMap = new Map(DEFAULT_SIDEBAR_ITEMS.map(i => [i.key, i]))
    const ordered: SidebarItemDefinition[] = []

    for (const k of keys) {
      const found = itemMap.get(k)
      if (found) {
        ordered.push(found)
        itemMap.delete(k)
      }
    }
    for (const remaining of itemMap.values()) {
      ordered.push(remaining)
    }
    return ordered
  } catch {
    return [...DEFAULT_SIDEBAR_ITEMS]
  }
}

function loadDisabledKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(DISABLED_STORAGE_KEY)
    if (!raw) return new Set<string>()
    const keys = JSON.parse(raw)
    return Array.isArray(keys) ? new Set(keys) : new Set<string>()
  } catch {
    return new Set<string>()
  }
}

const sidebarItems = ref<SidebarItemDefinition[]>(loadSavedOrder())
const disabledKeys = ref<Set<string>>(loadDisabledKeys())
const isReordering = ref(false)
const draggingKey = ref<string | null>(null)

// 过滤出启用的侧边栏部件
const visibleSidebarItems = computed(() => {
  return sidebarItems.value.filter(item => !disabledKeys.value.has(item.key))
})

export function useSidebarOrder() {
  const saveOrder = () => {
    try {
      const keys = sidebarItems.value.map(i => i.key)
      localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(keys))
    } catch {
      // ignore
    }
  }

  const saveDisabledKeys = () => {
    try {
      localStorage.setItem(DISABLED_STORAGE_KEY, JSON.stringify(Array.from(disabledKeys.value)))
    } catch {
      // ignore
    }
  }

  const resetOrder = () => {
    sidebarItems.value = [...DEFAULT_SIDEBAR_ITEMS]
    localStorage.removeItem(ORDER_STORAGE_KEY)
  }

  const reorderItems = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= sidebarItems.value.length ||
      toIndex >= sidebarItems.value.length
    ) {
      return
    }
    const list = [...sidebarItems.value]
    const [moved] = list.splice(fromIndex, 1)
    list.splice(toIndex, 0, moved)
    sidebarItems.value = list
    saveOrder()
  }

  const isItemEnabled = (key: string) => {
    return !disabledKeys.value.has(key)
  }

  const toggleItemEnabled = (key: string, enabled?: boolean) => {
    const nextSet = new Set(disabledKeys.value)
    const currentlyEnabled = !nextSet.has(key)
    const shouldEnable = enabled !== undefined ? enabled : !currentlyEnabled

    if (shouldEnable) {
      nextSet.delete(key)
    } else {
      // 至少保留一个部件开启，防止侧边栏被全部清空
      const remainingCount = sidebarItems.value.length - nextSet.size
      if (remainingCount <= 1 && currentlyEnabled) {
        return false // 不允许关闭最后一个
      }
      nextSet.add(key)
    }

    disabledKeys.value = nextSet
    saveDisabledKeys()
    return true
  }

  const enableAllItems = () => {
    disabledKeys.value = new Set()
    saveDisabledKeys()
  }

  const resetAllConfig = () => {
    resetOrder()
    enableAllItems()
  }

  return {
    sidebarItems,
    visibleSidebarItems,
    disabledKeys,
    isReordering,
    draggingKey,
    reorderItems,
    resetOrder,
    isItemEnabled,
    toggleItemEnabled,
    enableAllItems,
    resetAllConfig
  }
}
