import { computed, ref } from 'vue'

export interface ModelProviderProfile {
  id: string
  name: string
  notes?: string
  website?: string
  baseUrl: string
  apiKey: string
  selectedModel: string
  availableModels: string[]
  presetId?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface ProviderPreset {
  id: string
  name: string
  icon: string
  website?: string
  baseUrl: string
  defaultModel: string
  description: string
}

export interface ConnectionTestResult {
  success: boolean
  latencyMs?: number
  message?: string
  modelsCount?: number
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'custom',
    name: '自定义',
    icon: 'tune',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: '',
    description: '手动填写 Base URL 与 API Key'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: 'neurology',
    website: 'https://platform.deepseek.com',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    description: 'DeepSeek 官方 API 服务'
  },
  {
    id: 'aliyun',
    name: '阿里云百炼',
    icon: 'cloud',
    website: 'https://bailian.console.aliyun.com',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    description: '通义千问系列模型 (Qwen)'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: 'psychology',
    website: 'https://platform.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    description: 'OpenAI 官方 API 服务'
  },
  {
    id: 'ollama',
    name: 'Ollama',
    icon: 'desktop_windows',
    website: 'https://ollama.com',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: '',
    description: '本地离线大模型服务'
  }
]

const STORAGE_KEY = 'synyflow_model_providers_v2'
const ACTIVE_PROVIDER_KEY = 'synyflow_active_provider_id_v2'

const initialDefaultProviders: ModelProviderProfile[] = [
  {
    id: 'deepseek-default',
    name: 'DeepSeek',
    notes: '官方账号',
    website: 'https://platform.deepseek.com',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    selectedModel: 'deepseek-chat',
    availableModels: [],
    presetId: 'deepseek',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
]

const providers = ref<ModelProviderProfile[]>([])
const activeProviderId = ref<string>('')
let isInitialized = false

function init() {
  if (isInitialized) return
  isInitialized = true

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        providers.value = parsed
      } else {
        providers.value = initialDefaultProviders
      }
    } else {
      providers.value = initialDefaultProviders
    }
  } catch {
    providers.value = initialDefaultProviders
  }

  const savedActive = localStorage.getItem(ACTIVE_PROVIDER_KEY)
  if (savedActive && providers.value.some((p) => p.id === savedActive)) {
    activeProviderId.value = savedActive
  } else {
    activeProviderId.value = providers.value[0]?.id || ''
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers.value))
  localStorage.setItem(ACTIVE_PROVIDER_KEY, activeProviderId.value)
}

export function useModelProviders() {
  init()

  const activeProvider = computed(() => {
    return providers.value.find((p) => p.id === activeProviderId.value) || providers.value[0] || null
  })

  function setActiveProvider(id: string) {
    if (providers.value.some((p) => p.id === id)) {
      activeProviderId.value = id
      persist()
    }
  }

  function saveProvider(profile: Omit<ModelProviderProfile, 'createdAt' | 'updatedAt'> & { createdAt?: number }): ModelProviderProfile {
    const isNew = !profile.id || !providers.value.some((p) => p.id === profile.id)
    const id = isNew ? 'provider_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) : profile.id

    const fullProfile: ModelProviderProfile = {
      ...profile,
      id,
      name: profile.name.trim() || '未命名供应商',
      baseUrl: profile.baseUrl.trim().replace(/\/+$/, ''),
      apiKey: profile.apiKey.trim(),
      selectedModel: profile.selectedModel.trim(),
      availableModels: profile.availableModels || [],
      enabled: profile.enabled ?? true,
      createdAt: profile.createdAt || Date.now(),
      updatedAt: Date.now()
    }

    if (isNew) {
      providers.value.push(fullProfile)
      if (providers.value.length === 1 || !activeProviderId.value) {
        activeProviderId.value = fullProfile.id
      }
    } else {
      const index = providers.value.findIndex((p) => p.id === id)
      if (index !== -1) {
        providers.value[index] = fullProfile
      }
    }

    persist()
    return fullProfile
  }

  function deleteProvider(id: string) {
    providers.value = providers.value.filter((p) => p.id !== id)
    if (activeProviderId.value === id) {
      activeProviderId.value = providers.value[0]?.id || ''
    }
    persist()
  }

  /**
   * 测试连通性与网络延迟 (ms)
   */
  async function testConnection(baseUrl: string, apiKey: string): Promise<ConnectionTestResult> {
    const cleanUrl = baseUrl.trim().replace(/\/+$/, '')
    const startTime = performance.now()

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(`${cleanUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      }).finally(() => clearTimeout(timer))

      const latencyMs = Math.round(performance.now() - startTime)

      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        return {
          success: false,
          latencyMs,
          message: `连接失败 HTTP ${res.status}: ${errorText.slice(0, 120) || res.statusText}`
        }
      }

      const json = await res.json().catch(() => null)
      const modelCount = Array.isArray(json?.data) ? json.data.length : undefined

      return {
        success: true,
        latencyMs,
        modelsCount: modelCount,
        message: `连通正常 (${latencyMs}ms)${modelCount !== undefined ? ` · 检测到 ${modelCount} 个可用模型` : ''}`
      }
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - startTime)
      return {
        success: false,
        latencyMs,
        message: err.name === 'AbortError' ? '连接超时 (超过 10 秒)' : err.message || '网络连接失败'
      }
    }
  }

  /**
   * 获取模型列表 (/v1/models)
   */
  async function fetchModels(baseUrl: string, apiKey: string): Promise<{ success: boolean; models: string[]; message?: string }> {
    const cleanUrl = baseUrl.trim().replace(/\/+$/, '')

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)

      const res = await fetch(`${cleanUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      }).finally(() => clearTimeout(timer))

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        return {
          success: false,
          models: [],
          message: `拉取失败 HTTP ${res.status}: ${errText.slice(0, 100)}`
        }
      }

      const json = (await res.json()) as { data?: Array<{ id?: string }> }
      if (!json || !Array.isArray(json.data)) {
        return {
          success: false,
          models: [],
          message: '接口返回的数据未包含符合标准的 models 列表'
        }
      }

      const modelIds = json.data
        .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))

      if (!modelIds.length) {
        return {
          success: false,
          models: [],
          message: '获取到的模型列表为空'
        }
      }

      return {
        success: true,
        models: modelIds,
        message: `成功获取 ${modelIds.length} 个模型`
      }
    } catch (err: any) {
      return {
        success: false,
        models: [],
        message: err.name === 'AbortError' ? '请求超时' : err.message || '网络请求异常'
      }
    }
  }

  return {
    providers,
    activeProviderId,
    activeProvider,
    setActiveProvider,
    saveProvider,
    deleteProvider,
    testConnection,
    fetchModels
  }
}
