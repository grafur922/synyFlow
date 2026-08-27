import { ref } from 'vue'

export interface UserMemoryItem {
  id: string
  category: 'preference' | 'fact' | 'habit'
  content: string
  updatedAt: number
}

const MEMORY_STORAGE_KEY = 'synyflow_agent_user_memory_v1'

const memoryList = ref<UserMemoryItem[]>([])
let isInitialized = false

function initMemory() {
  if (isInitialized) return
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY)
    if (raw) {
      memoryList.value = JSON.parse(raw)
    } else {
      memoryList.value = []
    }
  } catch {
    memoryList.value = []
  }
  isInitialized = true
}

function persistMemory() {
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memoryList.value))
  } catch (err) {
    console.error('Failed to persist user memory:', err)
  }
}

export function useUserMemory() {
  initMemory()

  function addMemory(content: string, category: UserMemoryItem['category'] = 'preference') {
    const cleanContent = content.trim()
    if (!cleanContent) return
    // 简单防重
    const exists = memoryList.value.some((m) => m.content.toLowerCase() === cleanContent.toLowerCase())
    if (exists) return

    const newItem: UserMemoryItem = {
      id: 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      category,
      content: cleanContent,
      updatedAt: Date.now()
    }
    memoryList.value.unshift(newItem)
    persistMemory()
    return newItem
  }

  function removeMemory(id: string) {
    memoryList.value = memoryList.value.filter((m) => m.id !== id)
    persistMemory()
  }

  function clearAllMemories() {
    memoryList.value = []
    persistMemory()
  }

  function formatMemoriesForPrompt(): string {
    if (!memoryList.value.length) return ''
    const categoryLabels: Record<string, string> = {
      preference: '偏好',
      fact: '事实',
      habit: '习惯'
    }
    const lines = memoryList.value.slice(0, 15).map((m) => {
      const label = categoryLabels[m.category] || '信息'
      return `- [${label}] ${m.content}`
    })
    return `【用户已知偏好与背景记忆】：\n${lines.join('\n')}`
  }

  return {
    memories: memoryList,
    addMemory,
    removeMemory,
    clearAllMemories,
    formatMemoriesForPrompt
  }
}
