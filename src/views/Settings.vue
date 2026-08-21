<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { downloadClientBackup, exportClientBackup, restoreClientBackup } from '../services/clientBackup'
import { applyFontSizePreference, FONT_SIZE_OPTIONS, getFontSizePreference, type FontSizePreference } from '../services/appearance'
import { useTaskStore } from '../store/task'
import { xiaomiNotesApi } from '../services/xiaomiNotesApi'
import { ragApi } from '../services/ragApi'
import type { XiaomiConnectorStatus } from '../shared/xiaomiNote'
import type { RagSettingsResult, RagStatus, RagVectorIndexStatus, XiaomiRagSyncStatus } from '../shared/rag'

const taskStore = useTaskStore()
const currentTheme = ref(localStorage.getItem('taskflow_theme') || 'forest')
const currentFontSize = ref<FontSizePreference>(getFontSizePreference())
const backupPassphrase = ref('')
const showPassphrase = ref(false)
const busy = ref(false)
const toast = ref('')
const toastError = ref(false)
const xiaomiStatus = ref<XiaomiConnectorStatus>()
const passportSaving = ref(false)
const passportRefreshing = ref(false)
const showPassToken = ref(false)
const passportForm = reactive({ passToken: '', userId: '', cUserId: '', deviceId: '' })
const ragSettings = ref<RagSettingsResult>()
const ragVectorStatus = ref<RagVectorIndexStatus>()
const ragStatus = ref<RagStatus>()
const ragSyncStatus = ref<XiaomiRagSyncStatus>()
const ragLoading = ref(false)
const ragSaving = ref(false)
const ragTesting = ref(false)
const ragRebuilding = ref(false)
const showEmbeddingKey = ref(false)
const embeddingApiKey = ref('')
const ragForm = reactive({
  enabled: false,
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'text-embedding-v4',
  dimensions: 768,
  batchSize: 10,
  timeoutMs: 20_000,
  autoSyncXiaomi: true,
  xiaomiDefaultPrivacy: 'private' as 'public' | 'private' | 'secret',
  autoRetry: true,
  dailyTokenBudget: '' as number | ''
})
let toastTimer = 0

const themes = [
  { id: 'forest', name: '森林', color: '#416463' },
  { id: 'ocean', name: '海洋', color: '#2e597a' },
  { id: 'clay', name: '陶土', color: '#855440' },
  { id: 'amber', name: '琥珀', color: '#8a641b' }
]

function changeTheme(themeId: string) {
  currentTheme.value = themeId
  localStorage.setItem('taskflow_theme', themeId)
  const root = document.documentElement
  root.classList.remove('theme-ocean', 'theme-clay', 'theme-amber')
  if (themeId !== 'forest') root.classList.add(`theme-${themeId}`)
  notify('主题已更新')
}

function changeFontSize(preference: FontSizePreference) {
  currentFontSize.value = applyFontSizePreference(preference)
  notify(`字体大小已切换为${FONT_SIZE_OPTIONS.find((option) => option.id === preference)?.name || '标准'}`)
}

onMounted(async () => {
  const [xiaomi, knowledgeSettings, vectorStatus, knowledgeStatus, syncStatus] = await Promise.allSettled([
    xiaomiNotesApi.getStatus(),
    ragApi.getSettings(),
    ragApi.getVectorIndexStatus(),
    ragApi.getStatus(),
    ragApi.getXiaomiSyncStatus()
  ])
  if (xiaomi.status === 'fulfilled') xiaomiStatus.value = xiaomi.value
  if (knowledgeSettings.status === 'fulfilled') applyRagSettings(knowledgeSettings.value)
  if (vectorStatus.status === 'fulfilled') ragVectorStatus.value = vectorStatus.value
  if (knowledgeStatus.status === 'fulfilled') ragStatus.value = knowledgeStatus.value
  if (syncStatus.status === 'fulfilled') ragSyncStatus.value = syncStatus.value
})


function applyRagSettings(result: RagSettingsResult) {
  ragSettings.value = result
  Object.assign(ragForm, {
    enabled: result.storedSettings.enabled,
    baseUrl: result.storedSettings.baseUrl,
    model: result.storedSettings.model,
    dimensions: result.storedSettings.dimensions,
    batchSize: result.storedSettings.batchSize,
    timeoutMs: result.storedSettings.timeoutMs,
    autoSyncXiaomi: result.storedSettings.autoSyncXiaomi,
    xiaomiDefaultPrivacy: result.storedSettings.xiaomiDefaultPrivacy || 'private',
    autoRetry: result.storedSettings.autoRetry,
    dailyTokenBudget: result.storedSettings.dailyTokenBudget || ''
  })
}

async function reloadRagSettings() {
  if (ragLoading.value) return
  ragLoading.value = true
  try {
    const [settings, vector, status, sync] = await Promise.all([ragApi.getSettings(), ragApi.getVectorIndexStatus(), ragApi.getStatus(), ragApi.getXiaomiSyncStatus()])
    applyRagSettings(settings)
    ragVectorStatus.value = vector
    ragStatus.value = status
    ragSyncStatus.value = sync
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    ragLoading.value = false
  }
}

async function saveRagSettings() {
  if (ragSaving.value) return
  ragSaving.value = true
  try {
    applyRagSettings(await ragApi.updateSettings({
      enabled: ragForm.enabled,
      baseUrl: ragForm.baseUrl.trim(),
      model: ragForm.model.trim(),
      dimensions: Number(ragForm.dimensions),
      batchSize: Number(ragForm.batchSize),
      timeoutMs: Number(ragForm.timeoutMs),
      autoSyncXiaomi: ragForm.autoSyncXiaomi,
      xiaomiDefaultPrivacy: ragForm.xiaomiDefaultPrivacy,
      autoRetry: ragForm.autoRetry,
      dailyTokenBudget: ragForm.dailyTokenBudget === '' ? 0 : Number(ragForm.dailyTokenBudget)
    }))
    notify('知识库设置已保存')
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    ragSaving.value = false
  }
}

async function saveEmbeddingCredential() {
  const apiKey = embeddingApiKey.value.trim()
  if (!apiKey || ragSaving.value) return
  ragSaving.value = true
  try {
    await ragApi.saveEmbeddingCredential(apiKey)
    embeddingApiKey.value = ''
    showEmbeddingKey.value = false
    await reloadRagSettings()
    notify('阿里云 Embedding API Key 已写入 Windows DPAPI')
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    ragSaving.value = false
  }
}

async function removeEmbeddingCredential() {
  if (ragSaving.value || !window.confirm('确定删除本机 DPAPI 中的阿里云 Embedding API Key 吗？')) return
  ragSaving.value = true
  try {
    await ragApi.deleteEmbeddingCredential()
    await reloadRagSettings()
    notify('本机 Embedding API Key 已删除')
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    ragSaving.value = false
  }
}

async function testEmbeddingConnection() {
  if (ragTesting.value) return
  ragTesting.value = true
  try {
    const result = await ragApi.testEmbedding()
    notify(`连接成功：${result.model} · ${result.dimensions} 维 · ${result.latencyMs} ms`)
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    ragTesting.value = false
  }
}

async function rebuildRagVectors() {
  if (ragRebuilding.value || !window.confirm('将向阿里云发送全部非机密知识片段以重建向量索引，机密文档不会外发。继续吗？')) return
  ragRebuilding.value = true
  try {
    const result = await ragApi.rebuildVectorIndex()
    await reloadRagSettings()
    notify(`向量索引已重建：${result.vectorized} 个片段`)
  } catch (cause) {
    notify(messageFrom(cause), true)
    await reloadRagSettings()
  } finally {
    ragRebuilding.value = false
  }
}

async function savePassportCredentials(refreshAfterSave = true) {
  if (passportSaving.value || passportRefreshing.value) return
  const input = Object.fromEntries(Object.entries(passportForm).map(([name, value]) => [name, value.trim()]).filter(([, value]) => value))
  if (!Object.keys(input).length) {
    notify('请至少填写一个需要更新的凭证字段', true)
    return
  }
  passportSaving.value = true
  try {
    xiaomiStatus.value = await xiaomiNotesApi.updateRefreshCredentials(input)
    passportForm.passToken = ''
    passportForm.userId = ''
    passportForm.cUserId = ''
    passportForm.deviceId = ''
    showPassToken.value = false

    if (!refreshAfterSave) {
      notify('小米云 Passport 凭证已安全保存')
      return
    }

    try {
      xiaomiStatus.value = await xiaomiNotesApi.refreshNow()
      notify('小米云凭证已保存并获取 Cookie')
    } catch (cause) {
      notify(`凭证已保存，但暂时无法验证：${messageFrom(cause)}`, true)
    }
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    passportSaving.value = false
  }
}

async function refreshPassportNow() {
  if (passportRefreshing.value) return
  passportRefreshing.value = true
  try {
    xiaomiStatus.value = await xiaomiNotesApi.refreshNow()
    notify('小米云登录凭证已刷新')
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    passportRefreshing.value = false
  }
}

async function exportBackup() {
  if (busy.value) return
  busy.value = true
  try {
    const serialized = await exportClientBackup(backupPassphrase.value)
    downloadClientBackup(serialized)
    notify('客户端备份已导出')
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    busy.value = false
  }
}

async function restoreBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (!window.confirm('恢复将替换当前客户端 Todo 与界面偏好，是否继续？')) return
  busy.value = true
  try {
    const restored = await restoreClientBackup(await file.text(), backupPassphrase.value)
    downloadClientBackup(restored.beforeRestore, 'terra-client-before-restore')
    await taskStore.restoreTasks(restored.tasks)
    notify('客户端数据已恢复')
    window.setTimeout(() => window.location.reload(), 600)
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    busy.value = false
  }
}

function clearTasks() {
  if (!window.confirm('此操作将清空本地 Todo；已连接后端时也会同步清空。是否继续？')) return
  taskStore.clearAllTasks()
  notify('Todo 已清空')
}

function notify(message: string, isError = false) {
  window.clearTimeout(toastTimer)
  toast.value = message
  toastError.value = isError
  toastTimer = window.setTimeout(() => { toast.value = '' }, 2600)
}

function messageFrom(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败'
}
</script>

<template>
  <div class="h-full w-full overflow-y-auto bg-background text-on-background">
    <main class="mx-auto max-w-4xl px-5 py-7 pb-28 md:px-8 md:py-10">
      <header class="mb-10">
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary">settings</span><h2 class="font-headline text-2xl font-bold">系统设置</h2></div>
        <p class="mt-2 text-sm text-secondary">{{ taskStore.backendConfigured ? taskStore.backendOnline ? 'Todo 后端已连接' : 'Todo 后端当前离线' : 'Todo 使用本地存储' }}</p>
      </header>

      <section class="border-t border-outline-variant/30 py-7">
        <div class="mb-5 flex items-center gap-3"><span class="material-symbols-outlined text-primary">palette</span><div><h3 class="font-headline text-lg font-bold">外观</h3><p class="mt-1 text-xs text-secondary">当前主题：{{ themes.find((theme) => theme.id === currentTheme)?.name }}</p></div></div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button v-for="theme in themes" :key="theme.id" type="button" class="flex min-h-14 items-center gap-3 rounded-lg border px-3 text-left text-sm font-bold transition" :class="currentTheme === theme.id ? 'border-primary bg-primary-container text-on-primary-container' : 'border-outline-variant/30 bg-surface-bright text-secondary hover:border-primary/30'" :aria-pressed="currentTheme === theme.id" @click="changeTheme(theme.id)"><span class="h-6 w-6 flex-shrink-0 rounded-full border border-black/10" :style="{ backgroundColor: theme.color }"></span><span>{{ theme.name }}</span></button>
        </div>

        <div class="mt-6 border-t border-outline-variant/20 pt-5">
          <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div><h4 class="text-sm font-bold text-on-surface">整体字体大小</h4><p class="mt-1 text-xs text-secondary">同步调整标题、正文和相对布局尺寸</p></div>
            <span class="text-xs font-bold text-primary">{{ FONT_SIZE_OPTIONS.find((option) => option.id === currentFontSize)?.name }}</span>
          </div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <button v-for="option in FONT_SIZE_OPTIONS" :key="option.id" type="button" class="flex min-h-16 items-center gap-3 rounded-lg border px-3 text-left transition" :class="currentFontSize === option.id ? 'border-primary bg-primary-container text-on-primary-container' : 'border-outline-variant/30 bg-surface-bright text-secondary hover:border-primary/30'" :aria-pressed="currentFontSize === option.id" @click="changeFontSize(option.id)">
              <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-container-high font-headline font-bold text-on-surface" :style="{ fontSize: `${option.pixels}px` }">Aa</span>
              <span class="min-w-0"><span class="block text-sm font-bold">{{ option.name }}</span><span class="mt-0.5 block text-[10px] opacity-70">{{ option.pixels }}px · {{ option.description }}</span></span>
            </button>
          </div>
        </div>
      </section>

      <section class="border-t border-outline-variant/30 py-7">
        <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div class="flex items-center gap-3"><span class="material-symbols-outlined text-primary">key</span><div><h3 class="font-headline text-lg font-bold">小米云自动续期</h3><p class="mt-1 text-xs text-secondary">{{ xiaomiStatus?.passportRefresh.message || '正在读取自动续期状态…' }}</p></div></div>
          <span class="rounded-lg px-2.5 py-1 text-[10px] font-bold" :class="xiaomiStatus?.passportRefresh.configured ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-high text-secondary'">{{ xiaomiStatus?.passportRefresh.configured ? '已配置' : '未配置' }}</span>
        </div>

        <div v-if="xiaomiStatus?.passportRefresh" class="mb-5 grid gap-2 rounded-xl border border-outline-variant/25 bg-surface-container-low p-4 text-xs text-secondary sm:grid-cols-2">
          <div>凭证来源：<strong class="text-on-surface">{{ xiaomiStatus.passportRefresh.source === 'windows-dpapi' ? 'Windows DPAPI' : xiaomiStatus.passportRefresh.source === 'environment' ? '环境变量' : '未配置' }}</strong></div>
          <div>自动续期：<strong :class="xiaomiStatus.passportRefresh.available ? 'text-primary' : 'text-secondary'">{{ xiaomiStatus.passportRefresh.available ? '可用' : '不可用' }}</strong></div>
          <div>最近成功：<strong class="text-on-surface">{{ xiaomiStatus.passportRefresh.lastSuccessAt ? new Date(xiaomiStatus.passportRefresh.lastSuccessAt).toLocaleString('zh-CN') : '暂无' }}</strong></div>
          <div>最近失败：<strong class="text-on-surface">{{ xiaomiStatus.passportRefresh.lastFailureAt ? new Date(xiaomiStatus.passportRefresh.lastFailureAt).toLocaleString('zh-CN') : '暂无' }}</strong></div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-xs font-bold text-secondary">passToken
            <span class="mt-2 flex items-center rounded-lg border border-outline-variant/30 bg-surface-bright focus-within:ring-2 focus-within:ring-primary"><input v-model="passportForm.passToken" :type="showPassToken ? 'text' : 'password'" autocomplete="off" placeholder="留空表示不修改" class="min-w-0 flex-1 border-0 bg-transparent text-sm focus:ring-0" /><button type="button" class="flex h-10 w-10 items-center justify-center text-secondary" :aria-label="showPassToken ? '隐藏 passToken' : '显示 passToken'" @click="showPassToken = !showPassToken"><span class="material-symbols-outlined text-[19px]">{{ showPassToken ? 'visibility_off' : 'visibility' }}</span></button></span>
          </label>
          <label class="text-xs font-bold text-secondary">userId<input v-model="passportForm.userId" autocomplete="off" placeholder="留空表示不修改" class="mt-2 block w-full rounded-lg border-outline-variant/30 bg-surface-bright text-sm focus:border-primary focus:ring-primary" /></label>
          <label class="text-xs font-bold text-secondary">cUserId<input v-model="passportForm.cUserId" autocomplete="off" placeholder="留空表示不修改" class="mt-2 block w-full rounded-lg border-outline-variant/30 bg-surface-bright text-sm focus:border-primary focus:ring-primary" /></label>
          <label class="text-xs font-bold text-secondary">deviceId<input v-model="passportForm.deviceId" autocomplete="off" placeholder="留空表示不修改" class="mt-2 block w-full rounded-lg border-outline-variant/30 bg-surface-bright text-sm focus:border-primary focus:ring-primary" /></label>
        </div>
        <p class="mt-3 flex items-start gap-2 text-xs text-secondary"><span class="material-symbols-outlined mt-px text-[16px] text-primary">shield_lock</span><span>已保存的值不会回填到页面；空白字段保持原值。凭证只写入本机 Windows DPAPI。</span></p>
        <div class="mt-5 flex flex-wrap gap-2">
          <button type="button" class="action-button bg-primary text-on-primary" :disabled="passportSaving || passportRefreshing || !xiaomiStatus?.passportRefresh.writable" @click="savePassportCredentials(true)"><span class="material-symbols-outlined text-[19px]" :class="{ 'animate-spin': passportSaving }">{{ passportSaving ? 'progress_activity' : 'cookie' }}</span>{{ passportSaving ? '保存并获取中…' : xiaomiStatus?.passportRefresh.configured ? '保存并重新获取 Cookie' : '保存并获取 Cookie' }}</button>
          <button type="button" class="action-button border border-outline-variant/50 text-on-surface" :disabled="passportSaving || passportRefreshing || !xiaomiStatus?.passportRefresh.writable" @click="savePassportCredentials(false)"><span class="material-symbols-outlined text-[19px]">save</span>仅保存</button>
          <button type="button" class="action-button border border-primary/40 text-primary" :disabled="passportSaving || passportRefreshing || !xiaomiStatus?.passportRefresh.available" @click="refreshPassportNow"><span class="material-symbols-outlined text-[19px]" :class="{ 'animate-spin': passportRefreshing }">{{ passportRefreshing ? 'progress_activity' : 'sync_lock' }}</span>{{ passportRefreshing ? '获取中…' : '立即重新获取 Cookie' }}</button>
        </div>
      </section>

      <section class="border-t border-outline-variant/30 py-7">
        <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div class="flex items-center gap-3"><span class="material-symbols-outlined text-primary">neurology</span><div><h3 class="font-headline text-lg font-bold">知识库与语义检索</h3><p class="mt-1 text-xs text-secondary">阿里云 text-embedding-v4 · 本地 LanceDB · BM25 混合检索</p></div></div>
          <RouterLink to="/knowledge" class="action-button border border-outline-variant/40 text-primary"><span class="material-symbols-outlined text-[19px]">library_books</span>打开知识库</RouterLink>
        </div>

        <div v-if="ragSettings?.environmentOverrides.length" class="mb-4 rounded-lg border border-tertiary/30 bg-tertiary-container/35 p-3 text-xs text-on-tertiary-container">
          <strong>环境变量正在覆盖页面设置</strong><p class="mt-1 break-all">{{ ragSettings.environmentOverrides.join(' · ') }}</p>
        </div>

        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div class="rounded-lg border border-outline-variant/30 bg-surface-container-low p-4">
            <div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-sm font-bold">稠密语义检索</p><p class="mt-1 text-xs text-secondary">关闭时仍保留 BM25 和本地稀疏检索</p></div><label class="toggle-label"><input v-model="ragForm.enabled" type="checkbox" />启用</label></div>
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <label class="setting-field md:col-span-2">Base URL<input v-model="ragForm.baseUrl" type="url" maxlength="500" /></label>
              <label class="setting-field">模型<input v-model="ragForm.model" maxlength="100" /></label>
              <label class="setting-field">向量维度<input v-model.number="ragForm.dimensions" type="number" min="64" max="4096" step="1" /></label>
              <label class="setting-field">批次大小<input v-model.number="ragForm.batchSize" type="number" min="1" max="10" step="1" /></label>
              <label class="setting-field">超时毫秒<input v-model.number="ragForm.timeoutMs" type="number" min="1000" max="120000" step="1000" /></label>
              <label class="setting-field">小米笔记默认隐私<select v-model="ragForm.xiaomiDefaultPrivacy" class="mt-2 block w-full rounded-lg border-outline-variant/30 bg-surface-bright text-sm text-on-surface focus:border-primary focus:ring-primary"><option value="public">公开</option><option value="private">私人</option><option value="secret">机密（仅本地检索）</option></select></label><label class="setting-field">每日 Token 上限（可选）<input v-model.number="ragForm.dailyTokenBudget" type="number" min="1" max="100000000" placeholder="不设限" /></label>
            </div>
            <div class="mt-4 flex flex-wrap gap-4"><label class="toggle-label"><input v-model="ragForm.autoSyncXiaomi" type="checkbox" />刷新小米笔记后自动同步</label><label class="toggle-label"><input v-model="ragForm.autoRetry" type="checkbox" />同步失败自动重试</label></div>
            <div class="mt-5 flex flex-wrap gap-2"><button type="button" class="action-button bg-primary text-on-primary" :disabled="ragSaving" @click="saveRagSettings"><span class="material-symbols-outlined text-[19px]">save</span>{{ ragSaving ? '保存中…' : '保存设置' }}</button><button type="button" class="action-button border border-outline-variant/40 text-secondary" :disabled="ragLoading" @click="reloadRagSettings"><span class="material-symbols-outlined text-[19px]" :class="{ 'animate-spin': ragLoading }">refresh</span>重新读取</button></div>
          </div>

          <aside class="space-y-3">
            <div class="rounded-lg border border-outline-variant/30 bg-surface-bright p-4">
              <div class="flex items-center justify-between gap-2"><div><p class="text-sm font-bold">Embedding API Key</p><p class="mt-1 text-[10px] text-secondary">{{ ragSettings?.credential.configured ? `${ragSettings.credential.masked} · ${ragSettings.credential.source}` : '尚未配置' }}</p></div><span class="material-symbols-outlined" :class="ragSettings?.credential.configured ? 'text-primary' : 'text-tertiary'">key</span></div>
              <label class="mt-3 flex items-center rounded-lg border border-outline-variant/30 bg-background focus-within:ring-2 focus-within:ring-primary"><input v-model="embeddingApiKey" :type="showEmbeddingKey ? 'text' : 'password'" autocomplete="new-password" placeholder="sk-..." class="min-w-0 flex-1 border-0 bg-transparent text-sm focus:ring-0" /><button type="button" class="flex h-10 w-10 items-center justify-center text-secondary" @click="showEmbeddingKey = !showEmbeddingKey"><span class="material-symbols-outlined text-[18px]">{{ showEmbeddingKey ? 'visibility_off' : 'visibility' }}</span></button></label>
              <p class="mt-2 text-[10px] leading-4 text-secondary">API Key 不会写入 localStorage 或备份；页面保存时只写入 Windows DPAPI。</p>
              <div class="mt-3 flex flex-wrap gap-2"><button type="button" class="action-button bg-primary text-on-primary" :disabled="ragSaving || !embeddingApiKey.trim() || !ragSettings?.credential.writable" @click="saveEmbeddingCredential">保存 Key</button><button type="button" class="action-button border border-primary/40 text-primary" :disabled="ragTesting || !ragSettings?.credential.configured" @click="testEmbeddingConnection">{{ ragTesting ? '测试中…' : '测试连接' }}</button><button type="button" class="action-button border border-error/30 text-error" :disabled="ragSaving || !ragSettings?.credential.writable || ragSettings?.credential.source !== 'windows-dpapi'" @click="removeEmbeddingCredential">删除</button></div>
            </div>
            <div class="rounded-lg border border-outline-variant/30 bg-surface-bright p-4">
              <div class="flex items-center justify-between"><p class="text-sm font-bold">向量索引</p><span class="text-[10px] font-bold text-secondary">{{ ragVectorStatus?.store.available ? '可用' : '降级' }}</span></div>
              <p class="mt-2 text-xs leading-5 text-secondary">{{ ragVectorStatus?.store.message || '正在读取状态' }}</p>
              <p class="mt-2 text-[10px] text-secondary">就绪 {{ ragVectorStatus?.coverage.ready || 0 }} · 失败 {{ ragVectorStatus?.coverage.failed || 0 }} · 本地专用 {{ ragVectorStatus?.coverage.localOnly || 0 }}</p>
              <div class="mt-3 border-t border-outline-variant/20 pt-3 text-[10px] leading-5 text-secondary">
                <p>今日 Embedding 用量： {{ ragStatus?.denseEmbedding.usage.usedTokens || 0 }} Token<span v-if="ragStatus?.denseEmbedding.usage.budgetTokens"> / {{ ragStatus.denseEmbedding.usage.budgetTokens }}</span></p>
                <p>最近成功： {{ ragStatus?.denseEmbedding.lastSuccessAt ? new Date(ragStatus.denseEmbedding.lastSuccessAt).toLocaleString('zh-CN') : '\u6682\u65e0' }}</p>
                <p>最近失败： {{ ragStatus?.denseEmbedding.lastFailureAt ? new Date(ragStatus.denseEmbedding.lastFailureAt).toLocaleString('zh-CN') : '\u6682\u65e0' }}</p>
                <p v-if="ragStatus?.denseEmbedding.lastError" class="line-clamp-2 text-error">{{ ragStatus.denseEmbedding.lastError }}</p>
                <p class="mt-1">小米笔记同步： {{ ragSyncStatus?.state || 'idle' }} · 最近成功 {{ ragSyncStatus?.lastSuccessAt ? new Date(ragSyncStatus.lastSuccessAt).toLocaleString('zh-CN') : '\u6682\u65e0' }} · 失败 {{ ragSyncStatus?.failed || 0 }}</p>
              </div>
              <button type="button" class="action-button mt-3 w-full justify-center border border-primary/40 text-primary" :disabled="ragRebuilding || !ragSettings?.credential.configured || !ragForm.enabled" @click="rebuildRagVectors"><span class="material-symbols-outlined text-[19px]" :class="{ 'animate-spin': ragRebuilding }">database</span>{{ ragRebuilding ? '重建中…' : '重建全部向量' }}</button>
            </div>
          </aside>
        </div>

        <div class="mt-4 rounded-lg border-l-2 border-primary bg-primary-container/30 px-4 py-3 text-xs leading-5 text-secondary"><strong class="text-on-surface">隐私边界：</strong>public/private 文档可发送到阿里云生成 Embedding；secret 文档永不外发，只参与本地检索。检测到高风险查询时也会跳过外部查询向量。</div>
      </section>

      <section class="border-t border-outline-variant/30 py-7">
        <div class="mb-5 flex items-start justify-between gap-4"><div class="flex items-center gap-3"><span class="material-symbols-outlined text-primary">encrypted</span><div><h3 class="font-headline text-lg font-bold">客户端备份</h3><p class="mt-1 text-xs text-secondary">{{ taskStore.tasks.length }} 条 Todo · PBKDF2 + AES-256-GCM</p></div></div><span class="rounded-lg bg-surface-container-high px-2 py-1 text-[10px] font-bold text-secondary">本地</span></div>

        <label class="block max-w-xl text-xs font-bold text-secondary">备份口令
          <span class="mt-2 flex items-center rounded-lg border border-outline-variant/30 bg-surface-bright focus-within:ring-2 focus-within:ring-primary"><input v-model="backupPassphrase" :type="showPassphrase ? 'text' : 'password'" minlength="16" autocomplete="new-password" class="min-w-0 flex-1 border-0 bg-transparent text-sm focus:ring-0" /><button type="button" class="flex h-10 w-10 items-center justify-center text-secondary" :aria-label="showPassphrase ? '隐藏口令' : '显示口令'" @click="showPassphrase = !showPassphrase"><span class="material-symbols-outlined text-[19px]">{{ showPassphrase ? 'visibility_off' : 'visibility' }}</span></button></span>
        </label>

        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="action-button bg-primary text-on-primary" :disabled="busy" @click="exportBackup"><span class="material-symbols-outlined text-[19px]">download</span>导出</button>
          <label class="action-button cursor-pointer border border-outline-variant/40 text-primary" :class="{ 'pointer-events-none opacity-40': busy }"><span class="material-symbols-outlined text-[19px]">upload_file</span>恢复<input type="file" class="hidden" accept=".terra-client-backup,application/json" @change="restoreBackup" /></label>
        </div>
      </section>

      <section class="border-t border-outline-variant/30 py-7">
        <div class="mb-5 flex items-center gap-3"><span class="material-symbols-outlined text-error">warning</span><div><h3 class="font-headline text-lg font-bold">危险操作</h3><p class="mt-1 text-xs text-secondary">删除操作会同步到已连接的 Todo 后端</p></div></div>
        <button type="button" class="action-button border border-error/40 text-error hover:bg-error-container/40" @click="clearTasks"><span class="material-symbols-outlined text-[19px]">delete_sweep</span>清空 Todo</button>
      </section>

      <section class="border-t border-outline-variant/30 py-7 text-xs text-secondary">
        <div class="flex flex-wrap items-center justify-between gap-3"><span>Terra Hub 0.1.0</span><span>Vue 3 · NestJS · Tauri 2</span></div>
      </section>
    </main>

    <Transition name="toast">
      <div v-if="toast" role="status" class="fixed left-1/2 top-6 z-[120] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-3 text-sm font-bold shadow-xl" :class="toastError ? 'bg-error-container text-on-error-container' : 'bg-primary text-on-primary'"><span class="material-symbols-outlined text-[19px]">{{ toastError ? 'error' : 'check_circle' }}</span><span class="break-words">{{ toast }}</span></div>
    </Transition>
  </div>
</template>

<style scoped>
.setting-field {
  @apply text-xs font-bold text-secondary;
}
.setting-field input {
  @apply mt-2 block w-full rounded-lg border-outline-variant/30 bg-surface-bright text-sm text-on-surface focus:border-primary focus:ring-primary;
}
.action-button {
  @apply flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
</style>
