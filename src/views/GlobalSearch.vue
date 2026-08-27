<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search,
  SearchCheck,
  RotateCw,
  GitFork,
  AlertTriangle,
  AlertCircle,
  Tag,
  FolderKanban,
  MapPin,
  Compass,
  Clock,
  ArrowLeft,
  X,
  Loader2
} from 'lucide-vue-next'
import { resourceApi } from '../services/resourceApi'
import type { Resource, ResourceConflictResolution, ResourceConflictSummary, ResourceConflictVersion, ResourcePrivacy, ResourceSearchResult, ResourceSource, ResourceStoreStatus, ResourceType } from '../shared/resource'

const router = useRouter()
const query = ref('')
const type = ref<ResourceType | ''>('')
const source = ref<ResourceSource | ''>('')
const privacy = ref<ResourcePrivacy | ''>('private')
const tag = ref('')
const project = ref('')
const location = ref('')
const fromDate = ref('')
const toDate = ref('')
const results = ref<ResourceSearchResult[]>([])
const status = ref<ResourceStoreStatus>()
const selected = ref<Resource>()
const loading = ref(false)
const syncing = ref(false)
const detailLoading = ref(false)
const conflictOpen = ref(false)
const conflictLoading = ref(false)
const conflictResolving = ref(false)
const conflictScope = ref<'unresolved' | 'resolved'>('unresolved')
const conflicts = ref<ResourceConflictSummary[]>([])
const selectedConflict = ref<ResourceConflictVersion>()
const conflictError = ref('')
const error = ref('')
let searchTimer = 0
let requestId = 0

const typeOptions: Array<{ value: ResourceType | ''; label: string }> = [
  { value: '', label: '全部类型' },
  { value: 'task', label: 'Todo' },
  { value: 'note', label: '笔记' },
  { value: 'rss_item', label: 'RSS' },
  { value: 'blog_post', label: '博客' },
  { value: 'trip', label: '行程' },
  { value: 'document', label: '文档' }
]
const sourceOptions: Array<{ value: ResourceSource | ''; label: string }> = [
  { value: '', label: '全部来源' },
  { value: 'terra', label: 'synyFlow' },
  { value: 'xiaomi', label: '小米' },
  { value: 'rss', label: 'RSS' },
  { value: 'blog', label: '博客' },
  { value: 'travel', label: '旅行' },
  { value: 'upload', label: '文档' }
]

const emptyMessage = computed(() => query.value.trim() ? '没有找到匹配资源' : '输入关键词搜索 Todo、笔记和后续聚合内容')
const xiaomiCheckpoint = computed(() => status.value?.syncCheckpoints.find((checkpoint) => checkpoint.id === 'xiaomi:note'))

onMounted(async () => {
  await Promise.all([refreshStatus(), loadConflicts()])
})

onBeforeUnmount(() => window.clearTimeout(searchTimer))

watch([query, type, source, privacy, tag, project, location, fromDate, toDate], () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { void search() }, 300)
})

async function refreshStatus() {
  try { status.value = await resourceApi.getStatus() } catch (cause) { error.value = messageFrom(cause) }
}

async function search() {
  const value = query.value.trim()
  if (!value) {
    results.value = []
    loading.value = false
    return
  }
  const currentId = ++requestId
  loading.value = true
  error.value = ''
  try {
    const response = await resourceApi.search(value, {
      type: type.value,
      source: source.value,
      maxPrivacy: privacy.value || 'private',
      tag: tag.value.trim(),
      project: project.value.trim(),
      location: location.value.trim(),
      fromDate: fromDate.value,
      toDate: toDate.value,
      limit: 50
    })
    if (currentId === requestId) results.value = response
  } catch (cause) {
    if (currentId === requestId) error.value = messageFrom(cause)
  } finally {
    if (currentId === requestId) loading.value = false
  }
}

async function syncResources() {
  syncing.value = true
  error.value = ''
  try {
    const response = await resourceApi.syncAll()
    if (Object.keys(response.errors).length) {
      error.value = Object.entries(response.errors).map(([source, message]) => `${source}: ${message}`).join('；')
    }
    await refreshStatus()
    await loadConflicts()
    await search()
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    syncing.value = false
  }
}

async function openConflictArchive() {
  conflictOpen.value = true
  selectedConflict.value = undefined
  await loadConflicts()
}

async function loadConflicts() {
  conflictLoading.value = true
  conflictError.value = ''
  try {
    conflicts.value = await resourceApi.getConflicts(conflictScope.value)
  } catch (cause) {
    conflictError.value = messageFrom(cause)
  } finally {
    conflictLoading.value = false
  }
}

async function changeConflictScope(scope: 'unresolved' | 'resolved') {
  if (conflictScope.value === scope) return
  conflictScope.value = scope
  selectedConflict.value = undefined
  await loadConflicts()
}

async function selectConflict(conflict: ResourceConflictSummary) {
  conflictLoading.value = true
  conflictError.value = ''
  try {
    selectedConflict.value = await resourceApi.getConflict(conflict.id)
  } catch (cause) {
    conflictError.value = messageFrom(cause)
  } finally {
    conflictLoading.value = false
  }
}

async function resolveSelectedConflict(resolution: ResourceConflictResolution) {
  const conflict = selectedConflict.value
  if (!conflict || conflict.status !== 'unresolved' || conflictResolving.value) return
  const prompt = resolution === 'accept_incoming'
    ? '接受传入版本会替换当前 Resource 索引版本。源笔记不会在这里被修改，确定继续吗？'
    : '保留当前版本并关闭这条冲突，确定继续吗？'
  if (!window.confirm(prompt)) return
  conflictResolving.value = true
  conflictError.value = ''
  try {
    await resourceApi.resolveConflict(conflict.id, resolution)
    selectedConflict.value = undefined
    await Promise.all([loadConflicts(), refreshStatus()])
    await search()
  } catch (cause) {
    conflictError.value = messageFrom(cause)
  } finally {
    conflictResolving.value = false
  }
}

async function openDetail(result: ResourceSearchResult) {
  detailLoading.value = true
  error.value = ''
  try { selected.value = await resourceApi.getResource(result.id) } catch (cause) { error.value = messageFrom(cause) }
  finally { detailLoading.value = false }
}

function openSource(resource: Resource | ResourceSearchResult) {
  if (resource.type === 'task') void router.push(`/task-details/${encodeURIComponent(resource.sourceId)}`)
  else if (resource.type === 'note' && resource.source === 'xiaomi') void router.push({ path: '/xiaomi-notes', query: { note: resource.sourceId } })
  else if (resource.type === 'rss_item') void router.push({ path: '/rss', query: { item: resource.sourceId } })
  else if (resource.type === 'blog_post') void router.push({ path: '/blog', query: { draft: resource.sourceId } })
  else if (resource.type === 'trip') void router.push({ path: '/travel', query: { trip: resource.sourceId } })
  else if (resource.type === 'document') void router.push({ path: '/knowledge', query: { document: resource.sourceId } })
}

function canOpenSource(resource: Resource) {
  return resource.type === 'task'
    || (resource.type === 'note' && resource.source === 'xiaomi')
    || resource.type === 'rss_item'
    || resource.type === 'blog_post'
    || resource.type === 'trip'
    || resource.type === 'document'
}

function typeLabel(value: ResourceType) {
  return typeOptions.find((item) => item.value === value)?.label || value
}

function sourceLabel(value: string) {
  return ({ terra: 'synyFlow', xiaomi: '小米', rss: 'RSS', blog: '博客', travel: '旅行', upload: '文档' } as Record<string, string>)[value] || value
}

function privacyLabel(value: ResourcePrivacy) {
  return ({ public: '公开级', private: '私人', secret: '机密' } as Record<ResourcePrivacy, string>)[value]
}

function syncModeLabel(value?: string) {
  return value === 'full' ? '完整扫描' : value === 'incremental' ? '增量同步' : '尚未同步'
}

function conflictReasonLabel(value: ResourceConflictSummary['reason']) {
  return value === 'source_revision_regressed' ? '来源版本倒退' : '同版本内容分叉'
}

function conflictResolutionLabel(value?: ResourceConflictResolution) {
  return value === 'accept_incoming' ? '已接受传入版本' : value === 'keep_current' ? '已保留当前版本' : '未解决'
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

function contextTimeLabel(resource: Resource) {
  const time = resource.context.time
  if (!time) return ''
  if (time.startDate) return time.endDate && time.endDate !== time.startDate ? `${time.startDate} - ${time.endDate}` : time.startDate
  if (time.startAt !== undefined) return time.endAt && time.endAt !== time.startAt ? `${formatDate(time.startAt)} - ${formatDate(time.endAt)}` : formatDate(time.startAt)
  return ''
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误'
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <header class="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-outline-variant/25 px-5 py-4 md:px-8">
      <div>
        <div class="flex items-center gap-2">
          <SearchCheck class="h-5 w-5 text-primary flex-shrink-0" :stroke-width="2" />
          <h2 class="font-headline text-2xl font-bold">全局搜索</h2>
        </div>
        <p class="mt-1 text-xs text-secondary">统一 Resource 索引 · {{ status?.resourceCount || 0 }} 条可用资源<span v-if="status?.tombstoneCount"> · {{ status.tombstoneCount }} 条删除墓碑</span> · <span :class="status?.encryptedAtRest && status?.syncStorage?.encryptedAtRest ? 'text-primary' : 'text-tertiary'">{{ status?.encryptedAtRest && status?.syncStorage?.encryptedAtRest ? '索引与游标已加密' : '数据未完全加密' }}</span><span v-if="xiaomiCheckpoint"> · 小米{{ syncModeLabel(xiaomiCheckpoint.lastMode) }}</span></p>
      </div>
      <div class="flex w-full items-center justify-end gap-2 sm:w-auto">
        <button v-if="status?.conflictCount" class="flex h-10 items-center gap-1.5 rounded-lg border border-outline-variant/40 px-3 text-sm font-bold" :class="status.unresolvedConflictCount ? 'text-error' : 'text-secondary'" @click="openConflictArchive">
          <GitFork class="h-4 w-4" :stroke-width="2" />
          <span>冲突</span>
          <span v-if="status.unresolvedConflictCount" class="rounded-full bg-error px-1.5 py-0.5 text-[9px] text-on-error">{{ status.unresolvedConflictCount }}</span>
        </button>
        <button class="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-on-primary disabled:opacity-40" :disabled="syncing" @click="syncResources">
          <RotateCw class="h-4 w-4" :class="{ 'animate-spin': syncing }" :stroke-width="2" />
          <span>{{ syncing ? '同步索引中…' : '同步 Todo 与笔记' }}</span>
        </button>
      </div>
    </header>

    <div v-if="status?.unresolvedConflictCount" class="flex flex-shrink-0 items-center gap-2 border-b border-error/20 bg-error-container/45 px-5 py-2.5 text-xs text-on-error-container md:px-8">
      <GitFork class="h-4 w-4 text-error flex-shrink-0" :stroke-width="2" />
      <span class="min-w-0 flex-1">有 {{ status.unresolvedConflictCount }} 条跨端版本冲突等待处理，当前索引版本保持不变。</span>
      <button class="flex-shrink-0 font-bold underline" @click="openConflictArchive">查看冲突</button>
    </div>
    <div v-if="status?.xiaomiSync?.state === 'failed'" class="flex flex-shrink-0 items-start gap-2 border-b border-outline-variant/20 bg-error-container/50 px-5 py-2.5 text-xs text-on-error-container md:px-8">
      <AlertTriangle class="h-4 w-4 text-error flex-shrink-0" :stroke-width="2" />
      <span>小米笔记索引未更新：{{ status.xiaomiSync.error }}</span>
    </div>

    <div class="flex-shrink-0 border-b border-outline-variant/20 bg-surface-container-low/40 p-4 md:px-8">
      <div class="mx-auto grid max-w-5xl grid-cols-2 gap-2 lg:grid-cols-6">
        <label class="col-span-2 flex items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-bright px-4 py-3 focus-within:ring-2 focus-within:ring-primary/25 lg:col-span-4">
          <Search class="h-4.5 w-4.5 text-secondary flex-shrink-0" :stroke-width="2" />
          <input v-model="query" autofocus class="w-full border-0 bg-transparent p-0 focus:ring-0" placeholder="搜索笔记正文、Todo、标签……" />
        </label>
        <select v-model="type" aria-label="资源类型" class="rounded-xl border-outline-variant/30 bg-surface-bright text-sm font-bold focus:border-primary focus:ring-primary/20"><option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select>
        <select v-model="source" aria-label="资源来源" class="rounded-xl border-outline-variant/30 bg-surface-bright text-sm font-bold focus:border-primary focus:ring-primary/20"><option v-for="item in sourceOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select>
        <label class="filter-field">
          <Tag class="h-4 w-4 text-secondary flex-shrink-0" :stroke-width="2" />
          <input v-model="tag" aria-label="标签筛选" maxlength="120" placeholder="标签" />
        </label>
        <label class="filter-field">
          <FolderKanban class="h-4 w-4 text-secondary flex-shrink-0" :stroke-width="2" />
          <input v-model="project" aria-label="项目筛选" maxlength="120" placeholder="项目" />
        </label>
        <label class="filter-field">
          <MapPin class="h-4 w-4 text-secondary flex-shrink-0" :stroke-width="2" />
          <input v-model="location" aria-label="位置筛选" maxlength="120" placeholder="位置" />
        </label>
        <select v-model="privacy" aria-label="隐私范围" class="rounded-xl border-outline-variant/30 bg-surface-bright text-sm font-bold focus:border-primary focus:ring-primary/20"><option value="public">仅公开级</option><option value="private">公开与私人</option><option value="secret">全部（含机密）</option></select>
        <input v-model="fromDate" aria-label="开始日期" title="开始日期" type="date" class="rounded-xl border-outline-variant/30 bg-surface-bright text-xs font-bold focus:border-primary focus:ring-primary/20" />
        <input v-model="toDate" aria-label="结束日期" title="结束日期" type="date" class="rounded-xl border-outline-variant/30 bg-surface-bright text-xs font-bold focus:border-primary focus:ring-primary/20" />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-5 md:p-8">
      <div class="mx-auto max-w-5xl">
        <div v-if="error" class="mb-4 flex items-start gap-2 rounded-xl bg-error-container/60 p-3 text-sm text-on-error-container">
          <AlertCircle class="h-4 w-4 text-on-error-container flex-shrink-0" :stroke-width="2" />
          <span>{{ error }}</span>
        </div>
        <div v-if="loading" class="flex min-h-60 items-center justify-center text-secondary">
          <Loader2 class="mr-2 h-4 w-4 animate-spin" :stroke-width="2.5" />搜索中…
        </div>
        <div v-else-if="!results.length" class="flex min-h-72 flex-col items-center justify-center text-center text-secondary">
          <Compass class="mb-3 h-10 w-10 text-outline/60" :stroke-width="1.5" />
          <h3 class="font-headline text-xl font-bold text-on-surface">{{ emptyMessage }}</h3>
          <p v-if="!status?.resourceCount" class="mt-2 text-sm">首次使用请点击“同步 Todo 与笔记”建立加密索引。</p>
        </div>
        <div v-else class="space-y-3">
          <button v-for="result in results" :key="result.id" class="w-full rounded-xl border border-outline-variant/25 bg-surface-bright p-5 text-left shadow-sm transition hover:border-primary/30 hover:bg-surface-container-low" @click="openDetail(result)">
            <div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><span class="rounded-full bg-primary-container/20 px-2 py-0.5 text-[10px] font-bold text-primary">{{ typeLabel(result.type) }}</span><span class="text-[10px] font-bold text-secondary">{{ sourceLabel(result.source) }}</span><span class="text-[10px] font-bold" :class="result.privacy === 'secret' ? 'text-error' : 'text-secondary'">{{ privacyLabel(result.privacy) }}</span></div><h3 class="mt-2 line-clamp-1 font-headline text-lg font-bold text-on-surface">{{ result.title }}</h3></div><span class="rounded-full bg-surface-container-high px-2 py-1 text-[10px] font-bold text-secondary">相关度 {{ result.score }}</span></div>
            <p class="mt-2 line-clamp-2 text-sm leading-6 text-secondary">{{ result.highlights[0] || result.summary || '无摘要' }}</p>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <span v-for="itemTag in result.tags" :key="itemTag" class="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-bold text-on-secondary-container">#{{ itemTag }}</span>
              <span v-for="itemProject in result.context.projects.slice(0, 2)" :key="`project-${itemProject}`" class="flex items-center gap-1 text-[10px] font-bold text-secondary">
                <FolderKanban class="h-3.5 w-3.5 text-secondary flex-shrink-0" :stroke-width="2" />
                {{ itemProject }}
              </span>
              <span v-if="result.context.locations[0]" class="flex items-center gap-1 text-[10px] font-bold text-secondary">
                <MapPin class="h-3.5 w-3.5 text-secondary flex-shrink-0" :stroke-width="2" />
                {{ result.context.locations[0].name }}
              </span>
              <time class="ml-auto text-[10px] text-secondary">{{ formatDate(result.updatedAt) }}</time>
            </div>
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="conflictOpen" class="fixed inset-0 z-[95] flex justify-end bg-black/25" @click.self="conflictOpen = false">
        <aside role="dialog" aria-modal="true" aria-labelledby="resource-conflicts-title" class="flex h-full w-full max-w-6xl flex-col border-l border-outline-variant/30 bg-background shadow-2xl">
          <header class="flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant/25 px-4 py-3 md:px-5">
            <div class="min-w-0 flex-1"><h3 id="resource-conflicts-title" class="font-headline text-xl font-bold">Resource 版本冲突</h3><p class="mt-1 text-xs text-secondary">冲突版本加密保存在本机；解决操作只更新索引，不写回来源。</p></div>
            <button class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-surface-container-high" aria-label="关闭冲突归档" @click="conflictOpen = false">
              <X class="h-4 w-4" :stroke-width="2" />
            </button>
          </header>
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 px-4 py-2.5 md:px-5">
            <div class="flex rounded-lg bg-surface-container-high p-0.5"><button class="rounded-md px-3 py-1.5 text-xs font-bold" :class="conflictScope === 'unresolved' ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="changeConflictScope('unresolved')">待处理</button><button class="rounded-md px-3 py-1.5 text-xs font-bold" :class="conflictScope === 'resolved' ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="changeConflictScope('resolved')">已解决</button></div>
            <span class="text-xs text-secondary">{{ conflicts.length }} 条记录</span>
          </div>
          <div v-if="conflictError" class="flex items-start gap-2 border-b border-error/20 bg-error-container/55 px-4 py-2.5 text-xs text-on-error-container md:px-5">
            <AlertCircle class="h-4.5 w-4.5 text-on-error-container flex-shrink-0" :stroke-width="2" />
            <span class="min-w-0 flex-1">{{ conflictError }}</span>
            <button class="flex-shrink-0" aria-label="关闭冲突错误" @click="conflictError = ''">
              <X class="h-4 w-4" :stroke-width="2" />
            </button>
          </div>
          <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
            <section class="min-h-0 overflow-y-auto border-r border-outline-variant/25 bg-surface-container-low/45 p-3" :class="{ 'hidden md:block': selectedConflict }">
              <div v-if="conflictLoading && !conflicts.length" class="flex min-h-48 items-center justify-center text-sm text-secondary">
                <Loader2 class="mr-2 h-4 w-4 animate-spin" :stroke-width="2.5" />读取冲突…
              </div>
              <button v-for="conflict in conflicts" v-else :key="conflict.id" class="mb-2 w-full rounded-lg border p-3 text-left" :class="selectedConflict?.id === conflict.id ? 'border-primary/40 bg-primary-container text-on-primary-container' : 'border-transparent bg-surface-bright hover:border-outline-variant/40'" @click="selectConflict(conflict)"><div class="flex items-start justify-between gap-2"><span class="text-[10px] font-bold" :class="conflict.status === 'unresolved' ? 'text-error' : 'text-primary'">{{ conflictReasonLabel(conflict.reason) }}</span><time class="flex-shrink-0 text-[9px] opacity-65">{{ formatDate(conflict.detectedAt) }}</time></div><h4 class="mt-2 line-clamp-2 text-sm font-bold">{{ conflict.current.title }}</h4><p class="mt-1 line-clamp-2 text-xs opacity-70">传入：{{ conflict.incoming.title }}</p><p class="mt-2 text-[10px] opacity-65">{{ conflictResolutionLabel(conflict.resolution) }}</p></button>
              <div v-if="!conflictLoading && !conflicts.length" class="flex min-h-48 flex-col items-center justify-center text-center text-secondary">
                <GitFork class="mb-2 h-10 w-10 text-outline/50" :stroke-width="1.5" />
                <p class="text-sm font-bold">当前列表为空</p>
              </div>
            </section>

            <section class="min-h-0" :class="selectedConflict ? 'block' : 'hidden md:block'">
              <div v-if="conflictLoading && !selectedConflict" class="flex h-full items-center justify-center text-secondary">
                <Loader2 class="mr-2 h-4 w-4 animate-spin" :stroke-width="2.5" />读取版本…
              </div>
              <div v-else-if="selectedConflict" class="flex h-full min-h-0 flex-col">
                <div class="flex items-center gap-2 border-b border-outline-variant/20 px-3 py-2 md:px-4">
                  <button class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-secondary md:hidden" aria-label="返回冲突列表" @click="selectedConflict = undefined">
                    <ArrowLeft class="h-5 w-5" :stroke-width="2" />
                  </button>
                  <div class="min-w-0 flex-1"><p class="truncate text-sm font-bold">{{ conflictReasonLabel(selectedConflict.reason) }}</p><p class="mt-0.5 text-[10px] text-secondary">{{ sourceLabel(selectedConflict.source) }} · {{ formatDate(selectedConflict.detectedAt) }}</p></div><span class="flex-shrink-0 text-xs font-bold" :class="selectedConflict.status === 'unresolved' ? 'text-error' : 'text-primary'">{{ conflictResolutionLabel(selectedConflict.resolution) }}</span>
                </div>
                <div class="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
                  <div class="grid gap-4 lg:grid-cols-2">
                    <section class="min-w-0 border border-outline-variant/30 bg-surface-container-low"><header class="border-b border-outline-variant/25 p-3"><p class="text-[10px] font-bold text-primary">当前索引版本</p><h4 class="mt-1 break-words font-headline text-lg font-bold">{{ selectedConflict.current.title }}</h4><p class="mt-1 text-[10px] text-secondary">来源时间 {{ formatDate(selectedConflict.current.updatedAt) }} · {{ privacyLabel(selectedConflict.current.privacy) }}</p></header><pre class="max-h-[52vh] min-h-52 overflow-auto whitespace-pre-wrap p-4 font-body text-sm leading-6">{{ selectedConflict.current.content || '空白版本' }}</pre></section>
                    <section class="min-w-0 border border-outline-variant/30 bg-surface-container-low"><header class="border-b border-outline-variant/25 p-3"><p class="text-[10px] font-bold text-tertiary">传入来源版本</p><h4 class="mt-1 break-words font-headline text-lg font-bold">{{ selectedConflict.incoming.title }}</h4><p class="mt-1 text-[10px] text-secondary">来源时间 {{ formatDate(selectedConflict.incoming.updatedAt) }} · {{ privacyLabel(selectedConflict.incoming.privacy) }}</p></header><pre class="max-h-[52vh] min-h-52 overflow-auto whitespace-pre-wrap p-4 font-body text-sm leading-6">{{ selectedConflict.incoming.content || '空白版本' }}</pre></section>
                  </div>
                  <div v-if="selectedConflict.status === 'unresolved'" class="mt-5 flex flex-wrap justify-end gap-2"><button class="rounded-lg border border-outline-variant/40 px-4 py-2 text-sm font-bold text-secondary disabled:opacity-40" :disabled="conflictResolving" @click="resolveSelectedConflict('keep_current')">保留当前版本</button><button class="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-40" :disabled="conflictResolving" @click="resolveSelectedConflict('accept_incoming')">{{ conflictResolving ? '处理中…' : '接受传入版本' }}</button></div>
                </div>
              </div>
              <div v-else class="flex h-full flex-col items-center justify-center text-center text-secondary">
                <GitFork class="mb-2 h-12 w-12 text-outline/50" :stroke-width="1.5" />
                <p class="text-sm font-bold">选择一条冲突比较版本</p>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="selected || detailLoading" class="fixed inset-0 z-[90] flex justify-end bg-black/20 backdrop-blur-[2px]" @click.self="selected = undefined">
        <aside class="flex h-full w-full max-w-2xl flex-col border-l border-outline-variant/30 bg-background shadow-2xl">
          <div v-if="detailLoading" class="flex flex-1 items-center justify-center text-secondary">
            <Loader2 class="mr-2 h-5 w-5 animate-spin" :stroke-width="2.5" />读取资源…
          </div>
          <template v-else-if="selected">
            <header class="flex items-start justify-between gap-3 border-b border-outline-variant/25 p-5">
              <div>
                <div class="flex items-center gap-2 text-xs font-bold text-secondary">
                  <span>{{ typeLabel(selected.type) }}</span>
                  <span>·</span>
                  <span>{{ sourceLabel(selected.source) }}</span>
                  <span>·</span>
                  <span>{{ privacyLabel(selected.privacy) }}</span>
                </div>
                <h3 class="mt-2 font-headline text-2xl font-bold">{{ selected.title }}</h3>
              </div>
              <button class="flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-surface-container-high" @click="selected = undefined">
                <X class="h-5 w-5" :stroke-width="2" />
              </button>
            </header>
            <div class="min-h-0 flex-1 overflow-y-auto p-5">
              <p class="text-sm leading-6 text-secondary">{{ selected.summary }}</p>
              <div v-if="selected.context.projects.length || selected.context.locations.length || contextTimeLabel(selected)" class="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-y border-outline-variant/20 py-3 text-xs text-secondary">
                <span v-if="selected.context.projects.length" class="flex items-center gap-1">
                  <FolderKanban class="h-4 w-4 text-secondary flex-shrink-0" :stroke-width="2" />
                  {{ selected.context.projects.join('、') }}
                </span>
                <span v-if="contextTimeLabel(selected)" class="flex items-center gap-1">
                  <Clock class="h-4 w-4 text-secondary flex-shrink-0" :stroke-width="2" />
                  {{ contextTimeLabel(selected) }}
                </span>
                <span v-if="selected.context.locations.length" class="flex items-center gap-1">
                  <MapPin class="h-4 w-4 text-secondary flex-shrink-0" :stroke-width="2" />
                  {{ selected.context.locations.map((item) => item.name).join('、') }}
                </span>
              </div>
              <pre class="mt-5 whitespace-pre-wrap rounded-xl bg-surface-container-low p-5 font-body text-sm leading-7 text-on-surface">{{ selected.content || '该资源没有可显示的正文' }}</pre>
            </div>
            <footer class="flex items-center justify-between border-t border-outline-variant/25 p-4">
              <span class="text-xs text-secondary">索引于 {{ formatDate(selected.indexedAt) }}</span>
              <button v-if="canOpenSource(selected)" class="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary" @click="openSource(selected)">打开来源</button>
            </footer>
          </template>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.filter-field {
  @apply flex min-w-0 items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-bright px-3 text-secondary focus-within:border-primary focus-within:ring-2 focus-within:ring-primary;
}
.filter-field > input { @apply min-w-0 flex-1 border-0 bg-transparent px-0 py-2.5 text-sm text-on-surface placeholder:text-secondary focus:ring-0; }
</style>
