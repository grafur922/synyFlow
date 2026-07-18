<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { ragApi } from '../services/ragApi'
import type {
  RagCitation,
  RagDocument,
  RagDocumentSummary,
  RagMimeType,
  RagPrivacy,
  RagQueryProvider,
  RagQueryResult,
  RagStatus
} from '../shared/rag'

type WorkspaceTab = 'query' | 'document'
type CreateMode = 'document' | 'resource'

const privacyOptions: Array<{ value: RagPrivacy; label: string }> = [
  { value: 'public', label: '公开级' },
  { value: 'private', label: '私人' },
  { value: 'secret', label: '机密' }
]

const route = useRoute()
const documents = ref<RagDocumentSummary[]>([])
const selected = ref<RagDocument>()
const status = ref<RagStatus>()
const queryResult = ref<RagQueryResult>()
const filter = ref('')
const workspaceTab = ref<WorkspaceTab>('query')
const mobileWorkspace = ref(false)
const loading = ref(false)
const saving = ref(false)
const querying = ref(false)
const reindexing = ref(false)
const error = ref('')
const showCreate = ref(false)
const createMode = ref<CreateMode>('document')
const savedSnapshot = ref('')

const editForm = reactive({ title: '', content: '', tags: '', privacy: 'private' as RagPrivacy, mimeType: 'text/plain' as RagMimeType, originalFilename: '' })
const createForm = reactive({ title: '', content: '', tags: '', privacy: 'private' as RagPrivacy, mimeType: 'text/plain' as RagMimeType, originalFilename: '', resourceId: '' })
const queryForm = reactive({ query: '', maxPrivacy: 'private' as RagPrivacy, selectedOnly: false, includeFlagged: false, provider: 'local' as RagQueryProvider, externalConsent: false })

const filteredDocuments = computed(() => {
  const query = filter.value.trim().toLocaleLowerCase('zh-CN')
  if (!query) return documents.value
  return documents.value.filter((document) => `${document.title} ${document.summary} ${document.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(query))
})
const isDirty = computed(() => Boolean(selected.value) && JSON.stringify(editForm) !== savedSnapshot.value)
const selectedHighSensitive = computed(() => selected.value?.sensitiveFindings.filter((finding) => finding.severity === 'high') || [])
const selectedHighInjection = computed(() => selected.value?.injectionFindings.filter((finding) => finding.severity === 'high') || [])
const canShowDocument = computed(() => Boolean(selected.value))
const externalAvailable = computed(() => Boolean(status.value?.externalProvider.configured))

onMounted(async () => {
  window.addEventListener('keydown', handleShortcut)
  await refresh()
  const documentId = queryValue(route.query.document)
  if (documentId) await openDocumentById(documentId)
})

onBeforeUnmount(() => window.removeEventListener('keydown', handleShortcut))
onBeforeRouteLeave(() => allowDiscard())

watch(() => queryValue(route.query.document), (documentId, previous) => {
  if (documentId && documentId !== previous && documentId !== selected.value?.id) void openDocumentById(documentId)
})

async function refresh(showLoading = true) {
  if (showLoading) loading.value = true
  error.value = ''
  try {
    const [nextStatus, nextDocuments] = await Promise.all([ragApi.getStatus(), ragApi.getDocuments()])
    status.value = nextStatus
    documents.value = nextDocuments
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    if (showLoading) loading.value = false
  }
}

async function selectDocument(summary: RagDocumentSummary) {
  if (summary.id === selected.value?.id) {
    workspaceTab.value = 'document'
    mobileWorkspace.value = true
    return
  }
  if (!allowDiscard()) return
  await openDocumentById(summary.id)
}

async function openDocumentById(id: string) {
  loading.value = true
  error.value = ''
  try {
    applyDocument(await ragApi.getDocument(id))
    workspaceTab.value = 'document'
    mobileWorkspace.value = true
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    loading.value = false
  }
}

function applyDocument(document: RagDocument) {
  selected.value = document
  Object.assign(editForm, {
    title: document.title,
    content: document.content,
    tags: document.tags.join(', '),
    privacy: document.privacy,
    mimeType: document.mimeType,
    originalFilename: document.originalFilename || ''
  })
  savedSnapshot.value = JSON.stringify(editForm)
}

async function createDocument() {
  if (saving.value) return
  if (createMode.value === 'resource') {
    await importResource()
    return
  }
  saving.value = true
  error.value = ''
  try {
    const source = createForm.originalFilename ? 'file' : 'manual'
    const document = await ragApi.createDocument({
      title: createForm.title.trim(),
      content: createForm.content,
      tags: splitList(createForm.tags),
      privacy: createForm.privacy,
      mimeType: createForm.mimeType,
      source,
      originalFilename: createForm.originalFilename || undefined
    })
    applyDocument(document)
    resetCreateForm()
    showCreate.value = false
    workspaceTab.value = 'document'
    mobileWorkspace.value = true
    await refresh(false)
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    saving.value = false
  }
}

async function importResource() {
  const resourceId = createForm.resourceId.trim()
  if (!resourceId) return
  saving.value = true
  error.value = ''
  try {
    const document = await ragApi.createFromResource(resourceId)
    applyDocument(document)
    resetCreateForm()
    showCreate.value = false
    workspaceTab.value = 'document'
    mobileWorkspace.value = true
    await refresh(false)
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    saving.value = false
  }
}

async function saveDocument() {
  if (!selected.value || !isDirty.value || saving.value) return selected.value
  saving.value = true
  error.value = ''
  try {
    const document = await ragApi.updateDocument(selected.value.id, {
      title: editForm.title.trim(),
      content: editForm.content,
      tags: splitList(editForm.tags),
      privacy: editForm.privacy,
      mimeType: editForm.mimeType,
      originalFilename: editForm.originalFilename
    })
    applyDocument(document)
    await refresh(false)
    return document
  } catch (cause) {
    error.value = messageFrom(cause)
    return undefined
  } finally {
    saving.value = false
  }
}

async function deleteDocument() {
  if (!selected.value || !window.confirm(`确定删除“${selected.value.title}”及其全部索引片段吗？`)) return
  error.value = ''
  try {
    await ragApi.deleteDocument(selected.value.id)
    selected.value = undefined
    savedSnapshot.value = ''
    workspaceTab.value = 'query'
    mobileWorkspace.value = false
    await refresh(false)
  } catch (cause) {
    error.value = messageFrom(cause)
  }
}

async function reindexDocument() {
  const document = await saveDocument()
  if (!document || reindexing.value) return
  reindexing.value = true
  error.value = ''
  try {
    applyDocument(await ragApi.reindexDocument(document.id))
    await refresh(false)
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    reindexing.value = false
  }
}

async function reindexAll() {
  if (reindexing.value) return
  if (isDirty.value) {
    const saved = await saveDocument()
    if (!saved) return
  }
  reindexing.value = true
  error.value = ''
  try {
    await ragApi.reindexAll()
    await refresh(false)
    if (selected.value) applyDocument(await ragApi.getDocument(selected.value.id))
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    reindexing.value = false
  }
}

async function runQuery() {
  const query = queryForm.query.trim()
  if (!query || querying.value) return
  if (queryForm.selectedOnly && !selected.value) {
    error.value = '请先选择要限定的文档'
    return
  }
  querying.value = true
  error.value = ''
  workspaceTab.value = 'query'
  mobileWorkspace.value = true
  try {
    queryResult.value = await ragApi.query({
      query,
      maxPrivacy: queryForm.maxPrivacy,
      documentIds: queryForm.selectedOnly && selected.value ? [selected.value.id] : undefined,
      limit: 8,
      includeFlagged: queryForm.includeFlagged,
      provider: queryForm.provider,
      externalConsent: queryForm.provider === 'external' ? queryForm.externalConsent : undefined
    })
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    if (queryForm.provider === 'external') queryForm.externalConsent = false
    querying.value = false
  }
}

function selectQueryProvider(provider: RagQueryProvider) {
  if (provider === 'external' && !externalAvailable.value) return
  queryForm.provider = provider
  queryForm.externalConsent = false
  if (provider === 'external') {
    if (queryForm.maxPrivacy === 'secret') queryForm.maxPrivacy = 'private'
    queryForm.includeFlagged = false
  }
}

async function openCitation(citation: RagCitation) {
  if (selected.value?.id !== citation.documentId) {
    if (!allowDiscard()) return
    await openDocumentById(citation.documentId)
  } else {
    workspaceTab.value = 'document'
  }
}

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 460_000) {
    error.value = '文件超过 460 KB 接入上限'
    return
  }
  try {
    const content = await file.text()
    if (!content.trim()) throw new Error('文件内容为空')
    createForm.content = content
    createForm.originalFilename = file.name
    if (!createForm.title.trim()) createForm.title = file.name.replace(/\.[^.]+$/, '')
    createForm.mimeType = mimeTypeFor(file.name, file.type)
  } catch (cause) {
    error.value = messageFrom(cause)
  }
}

function openQueryWorkspace() {
  workspaceTab.value = 'query'
  mobileWorkspace.value = true
}

function closeMobileWorkspace() {
  if (!allowDiscard()) return
  selected.value = undefined
  workspaceTab.value = 'query'
  mobileWorkspace.value = false
}

function resetCreateForm() {
  Object.assign(createForm, { title: '', content: '', tags: '', privacy: 'private', mimeType: 'text/plain', originalFilename: '', resourceId: '' })
  createMode.value = 'document'
}

function allowDiscard() {
  return !isDirty.value || window.confirm('当前知识文档尚未保存，确定放弃修改吗？')
}

function handleShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('en-US') === 's') {
    event.preventDefault()
    void saveDocument()
  }
}

function splitList(value: string) {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
}

function queryValue(value: unknown) {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

function mimeTypeFor(filename: string, browserType: string): RagMimeType {
  const lower = filename.toLocaleLowerCase('en-US')
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown'
  if (lower.endsWith('.json') || browserType === 'application/json') return 'application/json'
  if (lower.endsWith('.csv') || browserType === 'text/csv') return 'text/csv'
  return 'text/plain'
}

function messageFrom(cause: unknown) {
  return cause instanceof Error ? cause.message : '发生未知错误'
}

function privacyLabel(value: RagPrivacy) {
  return privacyOptions.find((option) => option.value === value)?.label || value
}

function sourceLabel(value: string) {
  return ({ manual: '手动', file: '文件', resource: 'Resource' } as Record<string, string>)[value] || value
}

function confidenceLabel(value: string) {
  return ({ none: '无依据', low: '低', medium: '中', high: '高' } as Record<string, string>)[value] || value
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <header class="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-outline-variant/25 px-5 py-4 md:px-7">
      <div>
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary">library_books</span><h2 class="font-headline text-2xl font-bold">知识库</h2></div>
        <p class="mt-1 text-xs text-secondary">{{ status?.documentCount || 0 }} 个文档 · {{ status?.chunkCount || 0 }} 个片段 · <span :class="status?.encryptedAtRest ? 'text-primary' : 'text-tertiary'">{{ status?.encryptedAtRest ? '数据已加密' : '数据未加密' }}</span></p>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" class="header-action border border-outline-variant/40 text-primary md:hidden" @click="openQueryWorkspace"><span class="material-symbols-outlined text-[19px]">search</span>检索</button>
        <button type="button" class="header-action border border-outline-variant/40 text-primary" :disabled="reindexing" title="重建全部索引" @click="reindexAll"><span class="material-symbols-outlined text-[19px]" :class="{ 'animate-spin': reindexing }">sync</span><span class="hidden sm:inline">重建</span></button>
        <button type="button" class="header-action bg-primary text-on-primary" @click="showCreate = true"><span class="material-symbols-outlined text-[19px]">note_add</span>接入文档</button>
      </div>
    </header>

    <div v-if="error" role="alert" class="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-error-container/60 p-3 text-sm text-on-error-container"><span class="material-symbols-outlined text-[20px]">error</span><span class="min-w-0 flex-1">{{ error }}</span><button type="button" class="icon-button" aria-label="关闭错误提示" @click="error = ''"><span class="material-symbols-outlined text-[18px]">close</span></button></div>
    <div v-if="status?.resourceSyncError" class="mx-4 mt-3 rounded-lg bg-tertiary-container/50 p-3 text-xs text-on-tertiary-container">Resource 索引同步失败：{{ status.resourceSyncError }}</div>

    <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
      <aside class="min-h-0 border-r border-outline-variant/25 bg-surface-container-low/45" :class="{ 'hidden md:block': selected || mobileWorkspace }">
        <div class="flex h-full min-h-0 flex-col">
          <div class="p-3"><label class="flex items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-bright px-3 py-2 focus-within:ring-2 focus-within:ring-primary"><span class="material-symbols-outlined text-[19px] text-secondary">search</span><input v-model="filter" class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm focus:ring-0" placeholder="筛选文档" /></label></div>
          <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div v-if="loading && !documents.length" class="empty-state"><span class="material-symbols-outlined animate-spin">progress_activity</span><p>读取知识库中…</p></div>
            <button v-for="document in filteredDocuments" :key="document.id" type="button" class="mb-2 w-full rounded-lg border p-4 text-left transition" :class="selected?.id === document.id ? 'border-primary/40 bg-primary-container text-on-primary-container' : 'border-transparent bg-surface-bright hover:border-outline-variant/40'" @click="selectDocument(document)">
              <div class="flex items-start justify-between gap-2"><h3 class="line-clamp-2 min-w-0 text-sm font-bold">{{ document.title }}</h3><span class="flex-shrink-0 text-[9px] font-bold">{{ privacyLabel(document.privacy) }}</span></div>
              <p class="mt-2 line-clamp-2 text-xs leading-5 opacity-70">{{ document.summary }}</p>
              <div class="mt-3 flex items-center justify-between gap-2 text-[10px] opacity-65"><span>{{ document.chunkCount }} 片段 · {{ sourceLabel(document.source) }}</span><span v-if="document.highSensitiveFindingCount || document.highInjectionFindingCount" class="font-bold text-error">风险 {{ document.highSensitiveFindingCount + document.highInjectionFindingCount }}</span></div>
            </button>
            <div v-if="!loading && !filteredDocuments.length" class="empty-state"><span class="material-symbols-outlined text-4xl">inventory_2</span><p>{{ filter ? '没有匹配文档' : '还没有知识文档' }}</p></div>
          </div>
        </div>
      </aside>

      <main class="h-full min-h-0 min-w-0" :class="selected || mobileWorkspace ? 'block' : 'hidden md:block'">
        <div class="flex h-full min-h-0 flex-col">
          <div class="flex flex-shrink-0 items-center justify-between gap-2 border-b border-outline-variant/20 p-3">
            <button type="button" class="tool-button md:hidden" aria-label="返回文档列表" @click="closeMobileWorkspace"><span class="material-symbols-outlined">arrow_back</span></button>
            <div class="flex min-w-0 flex-1 gap-1">
              <button type="button" class="workspace-tab" :class="workspaceTab === 'query' ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container-high'" @click="workspaceTab = 'query'">检索</button>
              <button type="button" class="workspace-tab" :class="workspaceTab === 'document' ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container-high'" :disabled="!canShowDocument" @click="workspaceTab = 'document'">文档</button>
            </div>
            <div v-if="workspaceTab === 'document' && selected" class="flex flex-shrink-0 items-center gap-1">
              <button type="button" class="tool-button" title="重建当前文档索引" aria-label="重建当前文档索引" :disabled="reindexing" @click="reindexDocument"><span class="material-symbols-outlined" :class="{ 'animate-spin': reindexing }">refresh</span></button>
              <button type="button" class="tool-button text-error" title="删除文档" aria-label="删除文档" @click="deleteDocument"><span class="material-symbols-outlined">delete</span></button>
              <button type="button" class="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-on-primary disabled:opacity-40" :disabled="!isDirty || saving" @click="saveDocument">{{ saving ? '保存中…' : '保存' }}</button>
            </div>
          </div>

          <div v-if="loading" class="flex min-h-0 flex-1 items-center justify-center text-secondary"><span class="material-symbols-outlined mr-2 animate-spin">progress_activity</span>读取文档中…</div>

          <div v-else-if="workspaceTab === 'query'" class="min-h-0 flex-1 overflow-y-auto">
            <form class="border-b border-outline-variant/20 bg-surface-container-low/35 px-5 py-5 md:px-7" @submit.prevent="runQuery">
              <div class="mx-auto max-w-6xl">
                <label class="flex items-start gap-3 rounded-lg border border-outline-variant/35 bg-surface-bright px-4 py-3 focus-within:ring-2 focus-within:ring-primary"><span class="material-symbols-outlined mt-0.5 text-primary">search</span><textarea v-model="queryForm.query" class="min-h-14 min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-6 focus:ring-0" maxlength="500" rows="2" placeholder="输入要从知识库检索的问题"></textarea><button class="flex h-10 items-center gap-1 rounded-lg bg-primary px-4 text-xs font-bold text-on-primary disabled:opacity-40" :disabled="querying || !queryForm.query.trim() || queryForm.provider === 'external' && !queryForm.externalConsent"><span class="material-symbols-outlined text-[18px]" :class="{ 'animate-spin': querying }">{{ querying ? 'progress_activity' : 'arrow_forward' }}</span><span class="hidden sm:inline">检索</span></button></label>
                <div class="mt-3 flex flex-wrap items-center gap-3">
                  <div class="segmented" aria-label="检索提供方"><button type="button" :class="queryForm.provider === 'local' ? 'bg-primary text-on-primary' : 'text-secondary'" @click="selectQueryProvider('local')">本地</button><button type="button" :disabled="!externalAvailable" :title="status?.externalProvider.message" :class="queryForm.provider === 'external' ? 'bg-primary text-on-primary' : 'text-secondary'" @click="selectQueryProvider('external')">外部</button></div>
                  <div class="segmented" aria-label="最大隐私范围"><button v-for="option in privacyOptions" :key="option.value" type="button" :disabled="queryForm.provider === 'external' && option.value === 'secret'" :class="queryForm.maxPrivacy === option.value ? 'bg-primary text-on-primary' : 'text-secondary'" @click="queryForm.maxPrivacy = option.value">{{ option.label }}</button></div>
                  <label class="toggle-label"><input v-model="queryForm.selectedOnly" type="checkbox" :disabled="!selected" />仅当前文档</label>
                  <label class="toggle-label"><input v-model="queryForm.includeFlagged" type="checkbox" :disabled="queryForm.provider === 'external'" />包含隔离片段</label>
                  <label v-if="queryForm.provider === 'external'" class="toggle-label text-primary"><input v-model="queryForm.externalConsent" type="checkbox" />允许本次外部处理</label>
                  <span class="ml-auto text-[10px] font-bold text-secondary">{{ queryForm.provider === 'external' ? status?.externalProvider.embeddingModel : status?.embeddingProvider || 'local-hash-v1' }} · {{ queryForm.provider === 'external' ? '外部' : '本地' }}</span>
                </div>
              </div>
            </form>

            <div class="mx-auto grid max-w-6xl gap-8 px-5 py-7 md:grid-cols-[minmax(0,1fr)_320px] md:px-7">
              <section class="min-w-0">
                <div v-if="querying" class="empty-state min-h-72"><span class="material-symbols-outlined animate-spin text-3xl">progress_activity</span><p>检索与排序中…</p></div>
                <template v-else-if="queryResult">
                  <div class="flex flex-wrap items-center gap-2 text-xs font-bold"><span class="rounded-lg bg-primary-container px-2 py-1 text-on-primary-container">置信度 {{ confidenceLabel(queryResult.confidence) }}</span><span class="text-secondary">{{ queryResult.citations.length }} 条引用</span><span v-if="queryResult.excluded.privacy" class="text-secondary">隐私排除 {{ queryResult.excluded.privacy }}</span><span v-if="queryResult.excluded.flagged" class="text-tertiary">隔离 {{ queryResult.excluded.flagged }}</span><span v-if="queryResult.excluded.sensitive" class="text-error">敏感排除 {{ queryResult.excluded.sensitive }}</span></div>
                  <h3 class="mt-5 font-headline text-xl font-bold">检索结果</h3>
                  <div class="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-on-surface">{{ queryResult.answer }}</div>
                  <div v-if="queryResult.queryWarnings.length" class="mt-6 border-l-2 border-error pl-4"><p class="text-xs font-bold text-error">查询中检测到指令覆盖特征</p><p v-for="warning in queryResult.queryWarnings" :key="warning.id" class="mt-1 text-xs text-secondary">{{ warning.message }}</p></div>
                  <p class="mt-8 text-[10px] text-secondary">{{ queryResult.provider.answer }} · {{ queryResult.provider.externalRequests ? '外部' : '本地' }} · {{ formatDate(queryResult.generatedAt) }}</p>
                </template>
                <div v-else class="empty-state min-h-72"><span class="material-symbols-outlined text-5xl text-outline">manage_search</span><h3 class="font-headline text-lg font-bold text-on-surface">等待检索</h3></div>
              </section>

              <aside class="min-w-0 md:border-l md:border-outline-variant/30 md:pl-6">
                <div class="mb-4 flex items-center justify-between"><h3 class="text-xs font-bold uppercase text-secondary">证据</h3><span v-if="queryResult" class="text-[10px] text-secondary">{{ queryResult.citations.length }}</span></div>
                <div v-if="queryResult?.citations.length" class="evidence-rail">
                  <button v-for="citation in queryResult.citations" :key="citation.chunkId" type="button" class="evidence-item" @click="openCitation(citation)">
                    <span class="evidence-number">{{ citation.number }}</span>
                    <span class="block min-w-0"><span class="line-clamp-2 block text-xs font-bold text-on-surface">{{ citation.documentTitle }}</span><span v-if="citation.heading" class="mt-1 block truncate text-[10px] font-bold text-primary">{{ citation.heading }}</span><span class="mt-2 line-clamp-3 block text-xs leading-5 text-secondary">{{ citation.excerpt }}</span><span class="mt-2 flex items-center justify-between text-[9px] text-secondary"><span>{{ privacyLabel(citation.privacy) }}<span v-if="citation.injectionRisk !== 'none'" class="ml-1 text-error">· {{ citation.injectionRisk }}</span></span><span>{{ Math.round(citation.score * 100) }}%</span></span></span>
                  </button>
                </div>
                <p v-else class="text-xs leading-5 text-secondary">暂无可显示引用</p>
              </aside>
            </div>
          </div>

          <div v-else-if="selected" class="min-h-0 flex-1 overflow-y-auto p-5 md:p-7">
            <section class="mx-auto max-w-5xl">
              <div class="grid gap-4 md:grid-cols-2">
                <label class="field md:col-span-2">标题<input v-model="editForm.title" maxlength="300" class="font-headline text-lg font-bold" /></label>
                <label class="field">隐私级别<select v-model="editForm.privacy"><option v-for="option in privacyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                <label class="field">文档类型<select v-model="editForm.mimeType"><option value="text/plain">纯文本</option><option value="text/markdown">Markdown</option><option value="application/json">JSON</option><option value="text/csv">CSV</option></select></label>
                <label class="field md:col-span-2">标签<input v-model="editForm.tags" placeholder="逗号分隔" /></label>
                <label class="field md:col-span-2">正文<textarea v-model="editForm.content" maxlength="150000" rows="22" class="font-mono text-sm leading-6"></textarea></label>
              </div>

              <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-secondary"><span>{{ selected.chunkCount }} 个片段</span><span>{{ editForm.content.length.toLocaleString() }} 字符</span><span>{{ sourceLabel(selected.source) }}</span><span>索引于 {{ formatDate(selected.indexedAt) }}</span><span v-if="isDirty" class="font-bold text-tertiary">未保存</span></div>

              <section v-if="selected.sensitiveFindings.length" class="mt-8 border-t border-outline-variant/30 pt-6">
                <div class="flex items-center justify-between gap-3"><div><h3 class="font-headline text-base font-bold">敏感信息检测</h3><p class="mt-1 text-xs text-secondary">{{ selected.sensitiveFindings.length }} 项，其中高风险 {{ selectedHighSensitive.length }} 项</p></div><span class="material-symbols-outlined" :class="selectedHighSensitive.length ? 'text-error' : 'text-tertiary'">shield_lock</span></div>
                <div class="mt-4 divide-y divide-outline-variant/20"><div v-for="finding in selected.sensitiveFindings" :key="finding.id" class="flex items-start justify-between gap-4 py-3"><div class="min-w-0"><p class="text-xs font-bold" :class="finding.severity === 'high' ? 'text-error' : 'text-on-surface'">{{ finding.message }}</p><code class="mt-1 block truncate text-[10px] text-secondary">{{ finding.preview }}</code></div><span class="text-[9px] font-bold text-secondary">{{ finding.severity }}</span></div></div>
              </section>

              <section v-if="selected.injectionFindings.length" class="mt-8 border-t border-outline-variant/30 pt-6">
                <div class="flex items-center justify-between gap-3"><div><h3 class="font-headline text-base font-bold">提示注入检测</h3><p class="mt-1 text-xs text-secondary">{{ selected.injectionFindings.length }} 项，高风险片段默认不参与检索</p></div><span class="material-symbols-outlined" :class="selectedHighInjection.length ? 'text-error' : 'text-tertiary'">policy</span></div>
                <div class="mt-4 divide-y divide-outline-variant/20"><div v-for="finding in selected.injectionFindings" :key="finding.id" class="flex items-start justify-between gap-4 py-3"><p class="text-xs font-bold" :class="finding.severity === 'high' ? 'text-error' : 'text-on-surface'">{{ finding.message }}</p><span class="text-[9px] font-bold text-secondary">{{ finding.severity }}</span></div></div>
              </section>
            </section>
          </div>

          <div v-else class="flex min-h-0 flex-1 flex-col items-center justify-center text-center text-secondary"><span class="material-symbols-outlined mb-3 text-5xl text-outline">library_books</span><h3 class="font-headline text-lg font-bold text-on-surface">选择文档或开始检索</h3></div>
        </div>
      </main>
    </div>

    <Teleport to="body">
      <div v-if="showCreate" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4" @click.self="showCreate = false">
        <form role="dialog" aria-modal="true" aria-labelledby="rag-create-title" class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-background p-6 shadow-2xl" @submit.prevent="createDocument">
          <div class="flex items-center justify-between gap-3"><h3 id="rag-create-title" class="font-headline text-xl font-bold">接入知识文档</h3><button type="button" class="tool-button" aria-label="关闭" @click="showCreate = false"><span class="material-symbols-outlined">close</span></button></div>
          <div class="segmented mt-4 w-fit"><button type="button" :class="createMode === 'document' ? 'bg-primary text-on-primary' : 'text-secondary'" @click="createMode = 'document'">文本或文件</button><button type="button" :class="createMode === 'resource' ? 'bg-primary text-on-primary' : 'text-secondary'" @click="createMode = 'resource'">Resource</button></div>

          <template v-if="createMode === 'document'">
            <label class="mt-5 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-outline-variant/60 px-4 py-4 text-sm font-bold text-primary hover:bg-surface-container-low"><span class="material-symbols-outlined">upload_file</span>{{ createForm.originalFilename || '选择 TXT、Markdown、JSON 或 CSV' }}<input class="hidden" type="file" accept=".txt,.md,.markdown,.json,.csv,text/plain,text/markdown,application/json,text/csv" @change="handleFile" /></label>
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <label class="field md:col-span-2">标题<input v-model="createForm.title" required maxlength="300" /></label>
              <label class="field">隐私级别<select v-model="createForm.privacy"><option v-for="option in privacyOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
              <label class="field">文档类型<select v-model="createForm.mimeType"><option value="text/plain">纯文本</option><option value="text/markdown">Markdown</option><option value="application/json">JSON</option><option value="text/csv">CSV</option></select></label>
              <label class="field md:col-span-2">标签<input v-model="createForm.tags" placeholder="逗号分隔" /></label>
              <label class="field md:col-span-2">正文<textarea v-model="createForm.content" required maxlength="150000" rows="12"></textarea></label>
            </div>
          </template>
          <div v-else class="mt-5"><label class="field">Resource ID<input v-model="createForm.resourceId" required placeholder="例如 travel:trip:..." /></label></div>

          <div class="mt-5 flex justify-end gap-2"><button type="button" class="rounded-lg border border-outline-variant/40 px-4 py-2 text-sm font-bold text-secondary" @click="showCreate = false">取消</button><button class="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-40" :disabled="saving">{{ saving ? '接入中…' : createMode === 'resource' ? '导入' : '创建' }}</button></div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.header-action {
  @apply flex h-10 items-center gap-1 rounded-lg px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40;
}
.tool-button,
.icon-button {
  @apply flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40;
}
.workspace-tab {
  @apply rounded-lg px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-30;
}
.field {
  @apply flex min-w-0 flex-col gap-2 text-xs font-bold text-secondary;
}
.field :is(input, textarea, select) {
  @apply min-w-0 rounded-lg border-outline-variant/30 bg-surface-bright text-on-surface focus:border-primary focus:ring-2 focus:ring-primary;
}
.segmented {
  @apply flex rounded-lg bg-surface-container-high p-1;
}
.segmented button {
  @apply rounded-md px-3 py-1.5 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35;
}
.toggle-label {
  @apply flex items-center gap-2 text-[10px] font-bold text-secondary;
}
.toggle-label input {
  @apply h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary;
}
.empty-state {
  @apply flex min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-secondary;
}
.evidence-rail {
  @apply relative border-l border-outline-variant/50 pl-5;
}
.evidence-item {
  @apply relative block w-full border-b border-outline-variant/20 py-4 text-left last:border-b-0;
}
.evidence-number {
  @apply absolute -left-[2.08rem] top-4 flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-on-primary;
}
</style>
