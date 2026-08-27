<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  SlidersHorizontal,
  Plus,
  X,
  Trash2,
  ArrowLeft,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Save,
  Brain,
  Cloud,
  Bot,
  Laptop
} from 'lucide-vue-next'
import {
  useModelProviders,
  PROVIDER_PRESETS,
  type ModelProviderProfile,
  type ProviderPreset
} from '../../composables/useModelProviders'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'selected', provider: ModelProviderProfile): void
}>()

const {
  providers,
  activeProviderId,
  setActiveProvider,
  saveProvider,
  deleteProvider,
  testConnection,
  fetchModels
} = useModelProviders()

type ViewMode = 'list' | 'form'
const viewMode = ref<ViewMode>('list')
const isEditing = ref(false)
const showApiKey = ref(false)
const isTesting = ref(false)
const isFetchingModels = ref(false)
const testResult = ref<{ success?: boolean; message?: string } | null>(null)

const selectedPreset = ref<ProviderPreset>(PROVIDER_PRESETS[0])

const presetIconMap: Record<string, any> = {
  custom: SlidersHorizontal,
  deepseek: Brain,
  aliyun: Cloud,
  openai: Bot,
  ollama: Laptop
}

function getPresetIcon(id: string) {
  return presetIconMap[id] || SlidersHorizontal
}

const formData = reactive({
  id: '',
  name: '',
  notes: '',
  website: '',
  baseUrl: '',
  apiKey: '',
  selectedModel: '',
  availableModels: [] as string[],
  presetId: 'custom'
})

watch(
  () => props.open,
  (val) => {
    if (val) {
      viewMode.value = providers.value.length === 0 ? 'form' : 'list'
      testResult.value = null
    }
  },
  { immediate: true }
)

function openCreateForm(preset: ProviderPreset = PROVIDER_PRESETS[1]) {
  isEditing.value = false
  selectedPreset.value = preset
  formData.id = ''
  formData.name = preset.id === 'custom' ? '' : preset.name
  formData.notes = ''
  formData.website = preset.website || ''
  formData.baseUrl = preset.baseUrl
  formData.apiKey = ''
  formData.selectedModel = preset.defaultModel || ''
  formData.availableModels = []
  formData.presetId = preset.id
  testResult.value = null
  viewMode.value = 'form'
}

function openEditForm(provider: ModelProviderProfile) {
  isEditing.value = true
  const foundPreset = PROVIDER_PRESETS.find((p) => p.id === provider.presetId) || PROVIDER_PRESETS[0]
  selectedPreset.value = foundPreset
  formData.id = provider.id
  formData.name = provider.name
  formData.notes = provider.notes || ''
  formData.website = provider.website || ''
  formData.baseUrl = provider.baseUrl
  formData.apiKey = provider.apiKey
  formData.selectedModel = provider.selectedModel
  formData.availableModels = [...(provider.availableModels || [])]
  formData.presetId = provider.presetId || 'custom'
  testResult.value = null
  viewMode.value = 'form'
}

function applyPreset(preset: ProviderPreset) {
  selectedPreset.value = preset
  formData.presetId = preset.id
  if (!isEditing.value || !formData.name) {
    formData.name = preset.id === 'custom' ? '' : preset.name
  }
  formData.baseUrl = preset.baseUrl
  formData.website = preset.website || ''
  if (!isEditing.value) {
    formData.selectedModel = preset.defaultModel || ''
    formData.availableModels = []
  }
  testResult.value = null
}

async function handleTestConnection() {
  if (!formData.baseUrl.trim()) {
    testResult.value = { success: false, message: '请先填写 Base URL' }
    return
  }
  isTesting.value = true
  testResult.value = null
  try {
    const res = await testConnection(formData.baseUrl, formData.apiKey)
    testResult.value = {
      success: res.success,
      message: res.message
    }
  } finally {
    isTesting.value = false
  }
}

async function handleFetchModels() {
  if (!formData.baseUrl.trim()) {
    testResult.value = { success: false, message: '请先填写 Base URL' }
    return
  }
  isFetchingModels.value = true
  testResult.value = null
  try {
    const res = await fetchModels(formData.baseUrl, formData.apiKey)
    testResult.value = {
      success: res.success,
      message: res.message
    }
    if (res.success && res.models.length) {
      formData.availableModels = res.models
      if (!formData.selectedModel || !res.models.includes(formData.selectedModel)) {
        formData.selectedModel = res.models[0]
      }
    }
  } finally {
    isFetchingModels.value = false
  }
}

function handleSubmit() {
  if (!formData.name.trim()) {
    testResult.value = { success: false, message: '请填写供应商名称' }
    return
  }
  if (!formData.baseUrl.trim()) {
    testResult.value = { success: false, message: '请填写 Base URL' }
    return
  }

  const saved = saveProvider({
    id: formData.id,
    name: formData.name,
    notes: formData.notes,
    website: formData.website,
    baseUrl: formData.baseUrl,
    apiKey: formData.apiKey,
    selectedModel: formData.selectedModel,
    availableModels: formData.availableModels,
    presetId: formData.presetId,
    enabled: true
  })

  emit('selected', saved)
  viewMode.value = 'list'
}

function handleDelete(id: string) {
  if (confirm('确定要删除这个模型供应商吗？')) {
    deleteProvider(id)
  }
}

function handleSelectActive(p: ModelProviderProfile) {
  setActiveProvider(p.id)
  emit('selected', p)
}

const logoLetter = computed(() => {
  return (formData.name.trim().charAt(0) || 'P').toUpperCase()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[999] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm transition-opacity"
      @click.self="emit('close')"
    >
      <div
        class="relative flex h-[88vh] max-h-[760px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface shadow-2xl transition-all"
      >
        <!-- ================= 视图 1：供应商列表视图 ================= -->
        <template v-if="viewMode === 'list'">
          <!-- 顶部 Header -->
          <div class="flex items-center justify-between border-b border-outline-variant/20 px-6 py-4">
            <div class="flex items-center gap-2.5">
              <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <SlidersHorizontal class="h-5 w-5" :stroke-width="2" />
              </div>
              <div>
                <h3 class="text-base font-bold text-on-surface">模型管理</h3>
                <p class="text-xs text-secondary">管理你的模型供应商与 API Key 配置</p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button
                class="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-on-primary shadow-sm hover:opacity-90 transition"
                @click="openCreateForm()"
              >
                <Plus class="h-4 w-4" :stroke-width="2.2" />
                <span>添加新供应商</span>
              </button>
              <button
                class="flex h-8 w-8 items-center justify-center rounded-lg text-secondary hover:bg-surface-container hover:text-on-surface"
                @click="emit('close')"
              >
                <X class="h-4 w-4" :stroke-width="2" />
              </button>
            </div>
          </div>

          <!-- 供应商列表 -->
          <div class="flex-1 overflow-y-auto p-6 space-y-3">
            <div
              v-for="p in providers"
              :key="p.id"
              class="group relative flex items-center justify-between rounded-2xl border p-4 transition"
              :class="[
                p.id === activeProviderId
                  ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30 shadow-sm'
                  : 'border-outline-variant/30 bg-surface-container-lowest hover:border-outline-variant/60 hover:bg-surface-container-low'
              ]"
            >
              <div class="flex min-w-0 items-center gap-3.5 flex-1">
                <!-- 品牌 Logo 字母徽章 -->
                <div
                  class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl font-headline text-sm font-bold shadow-xs transition"
                  :class="[
                    p.id === activeProviderId
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-high text-on-surface'
                  ]"
                >
                  {{ (p.name.charAt(0) || 'P').toUpperCase() }}
                </div>

                <!-- 供应商基本信息 -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <h4 class="truncate text-sm font-bold text-on-surface">{{ p.name }}</h4>
                    <span
                      v-if="p.id === activeProviderId"
                      class="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary"
                    >
                      当前活跃
                    </span>
                    <span
                      v-if="p.apiKey"
                      class="flex items-center gap-0.5 text-[10px] text-primary"
                    >
                      <Key class="h-3 w-3" />
                      <span>已存 Key</span>
                    </span>
                  </div>

                  <p class="mt-0.5 truncate font-mono text-[11px] text-secondary">
                    {{ p.selectedModel || '未选择模型' }} · <span class="opacity-70">{{ p.baseUrl }}</span>
                  </p>
                </div>
              </div>

              <!-- 右侧操作区 -->
              <div class="flex items-center gap-2">
                <button
                  v-if="p.id !== activeProviderId"
                  class="rounded-xl border border-outline-variant/40 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 transition"
                  @click="handleSelectActive(p)"
                >
                  设为主力
                </button>

                <button
                  class="flex h-8 w-8 items-center justify-center rounded-lg text-secondary hover:bg-surface-container-high hover:text-on-surface transition"
                  title="编辑"
                  @click="openEditForm(p)"
                >
                  <SlidersHorizontal class="h-4 w-4" :stroke-width="2" />
                </button>

                <button
                  class="flex h-8 w-8 items-center justify-center rounded-lg text-secondary hover:bg-error/10 hover:text-error transition"
                  title="删除"
                  @click="handleDelete(p.id)"
                >
                  <Trash2 class="h-4 w-4" :stroke-width="2" />
                </button>
              </div>
            </div>
          </div>
        </template>

        <!-- ================= 视图 2：添加 / 编辑供应商表单视图 (CC Switch 风格) ================= -->
        <template v-else>
          <!-- 顶部 Header（返回箭头 + 标题） -->
          <div class="flex items-center justify-between border-b border-outline-variant/20 px-6 py-4">
            <div class="flex items-center gap-3">
              <button
                class="flex h-8 w-8 items-center justify-center rounded-xl border border-outline-variant/30 text-secondary hover:border-primary hover:bg-surface-container-high hover:text-primary transition"
                @click="viewMode = 'list'"
                title="返回供应商列表"
              >
                <ArrowLeft class="h-4 w-4" :stroke-width="2" />
              </button>
              <h3 class="text-base font-bold text-on-surface">
                {{ isEditing ? '编辑供应商' : '添加新供应商' }}
              </h3>
            </div>

            <button
              class="flex h-8 w-8 items-center justify-center rounded-lg text-secondary hover:bg-surface-container hover:text-on-surface"
              @click="emit('close')"
            >
              <X class="h-4 w-4" :stroke-width="2" />
            </button>
          </div>

          <!-- 表单滚动区域 -->
          <div class="flex-1 overflow-y-auto p-6 space-y-5">
            <!-- 预设选择卡片行 -->
            <div>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <button
                  v-for="preset in PROVIDER_PRESETS"
                  :key="preset.id"
                  type="button"
                  class="flex flex-col items-center justify-center rounded-xl border p-2.5 text-center transition"
                  :class="[
                    selectedPreset.id === preset.id
                      ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30 font-bold'
                      : 'border-outline-variant/25 bg-surface-container text-secondary hover:border-outline-variant/50 hover:bg-surface-container-high hover:text-on-surface'
                  ]"
                  @click="applyPreset(preset)"
                >
                  <component :is="getPresetIcon(preset.id)" class="h-4 w-4 mb-1" :stroke-width="2" />
                  <span class="text-xs">{{ preset.name }}</span>
                </button>
              </div>

              <p class="mt-2 text-xs text-secondary flex items-center gap-1">
                <span>💡</span>
                <span>{{ selectedPreset.id === 'custom' ? '自定义配置需手动填写所有必要字段' : `选择 ${selectedPreset.name} 预设后，请在下方填写 API Key` }}</span>
              </p>
            </div>

            <!-- 居中大图标卡片 -->
            <div class="flex justify-center py-1">
              <div class="flex h-16 w-16 items-center justify-center rounded-2xl border border-outline-variant/30 bg-surface-container-lowest font-headline text-2xl font-bold text-primary shadow-sm">
                {{ logoLetter }}
              </div>
            </div>

            <!-- 表单输入区 -->
            <div class="space-y-4">
              <!-- 供应商名称 与 备注 -->
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label class="mb-1 block text-xs font-bold text-on-surface">供应商名称</label>
                  <input
                    v-model="formData.name"
                    type="text"
                    class="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3.5 py-2 text-xs font-medium text-on-surface placeholder:text-secondary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="例如：Claude 官方、DeepSeek 主力"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs font-bold text-on-surface">备注</label>
                  <input
                    v-model="formData.notes"
                    type="text"
                    class="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3.5 py-2 text-xs font-medium text-on-surface placeholder:text-secondary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="例如：公司专用账号、备用中转"
                  />
                </div>
              </div>

              <!-- 官网链接 -->
              <div>
                <label class="mb-1 block text-xs font-bold text-on-surface">官网链接</label>
                <input
                  v-model="formData.website"
                  type="text"
                  class="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3.5 py-2 text-xs font-medium text-on-surface placeholder:text-secondary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="https://example.com（可选）"
                />
              </div>

              <!-- API Key -->
              <div>
                <label class="mb-1 block text-xs font-bold text-on-surface">API Key</label>
                <div class="relative">
                  <input
                    v-model="formData.apiKey"
                    :type="showApiKey ? 'text' : 'password'"
                    class="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest pl-3.5 pr-10 py-2 font-mono text-xs text-on-surface placeholder:text-secondary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                  <button
                    type="button"
                    class="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary hover:text-on-surface"
                    @click="showApiKey = !showApiKey"
                  >
                    <EyeOff v-if="showApiKey" class="h-4.5 w-4.5" :stroke-width="1.8" />
                    <Eye v-else class="h-4.5 w-4.5" :stroke-width="1.8" />
                  </button>
                </div>
              </div>

              <!-- Base URL 与 测试 -->
              <div>
                <div class="mb-1 flex items-center justify-between">
                  <label class="text-xs font-bold text-on-surface">Base URL</label>
                  <button
                    type="button"
                    class="text-xs font-bold text-primary transition-opacity duration-150 hover:opacity-70 disabled:opacity-40"
                    :disabled="isTesting"
                    @click="handleTestConnection"
                  >
                    <span>{{ isTesting ? '测试中...' : '测试连通性' }}</span>
                  </button>
                </div>
                <input
                  v-model="formData.baseUrl"
                  type="text"
                  class="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3.5 py-2 font-mono text-xs text-on-surface placeholder:text-secondary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <!-- 选用模型 与 拉取 -->
              <div>
                <div class="mb-1 flex items-center justify-between">
                  <label class="text-xs font-bold text-on-surface">选用模型</label>
                  <button
                    type="button"
                    class="text-xs font-bold text-primary transition-opacity duration-150 hover:opacity-70 disabled:opacity-40"
                    :disabled="isFetchingModels"
                    @click="handleFetchModels"
                  >
                    <span>{{ isFetchingModels ? '获取中...' : '获取模型列表' }}</span>
                  </button>
                </div>

                <div>
                  <input
                    v-if="!formData.availableModels.length"
                    v-model="formData.selectedModel"
                    type="text"
                    placeholder="例如：deepseek-chat 或 gpt-4o-mini"
                    class="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3.5 py-2 font-mono text-xs text-on-surface placeholder:text-secondary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <select
                    v-else
                    v-model="formData.selectedModel"
                    class="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3.5 py-2 font-mono text-xs font-bold text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option v-for="m in formData.availableModels" :key="m" :value="m">
                      {{ m }}
                    </option>
                  </select>
                </div>
              </div>

              <!-- 测试结果提示 -->
              <div
                v-if="testResult"
                class="flex items-center gap-2 rounded-xl p-3 text-xs"
                :class="testResult.success ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-error/10 text-error border border-error/20'"
              >
                <CheckCircle2 v-if="testResult.success" class="h-4.5 w-4.5 flex-shrink-0" :stroke-width="2" />
                <AlertCircle v-else class="h-4.5 w-4.5 flex-shrink-0" :stroke-width="2" />
                <span class="font-medium">{{ testResult.message }}</span>
              </div>
            </div>
          </div>

          <!-- 底部控制栏 -->
          <div class="flex items-center justify-between border-t border-outline-variant/20 bg-surface-container-low/40 px-6 py-3.5">
            <span class="text-xs text-secondary">
              💡 填写完毕后点击保存生效
            </span>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded-xl border border-outline-variant/30 px-4 py-2 text-xs font-bold text-on-surface hover:bg-surface-container transition"
                @click="viewMode = 'list'"
              >
                取消
              </button>
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-on-primary shadow-sm hover:opacity-90 transition"
                @click="handleSubmit"
              >
                <Save v-if="isEditing" class="h-4 w-4" :stroke-width="2" />
                <Plus v-else class="h-4 w-4" :stroke-width="2" />
                <span>{{ isEditing ? '保存修改' : '添加' }}</span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
