<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Rss,
  RotateCw,
  Plus,
  AlertCircle,
  AlertTriangle,
  Layers,
  Trash2,
  Star,
  Inbox,
  Loader2,
  ArrowLeft,
  ExternalLink,
  Newspaper,
  X
} from 'lucide-vue-next'
import { rssApi } from '../services/rssApi'
import type { RssItem, RssItemSummary, RssStatus, RssSubscription } from '../shared/rss'

const route = useRoute()
const initialItemId = queryValue(route.query.item)
const subscriptions = ref<RssSubscription[]>([])
const items = ref<RssItemSummary[]>([])
const selectedSubscriptionId = ref('')
const selectedItem = ref<RssItem>()
const status = ref<RssStatus>()
const scope = ref<'unread' | 'all' | 'favorite'>(initialItemId ? 'all' : 'unread')
const loading = ref(false)
const loadingDetail = ref(false)
const syncing = ref(false)
const error = ref('')
const total = ref(0)
const showAdd = ref(false)
const addForm = reactive({ url: '', title: '', tags: '' })

const hasMore = computed(() => items.value.length < total.value)

onMounted(async () => {
  await Promise.all([loadStatus(), loadSubscriptions()])
  await loadItems(true)
  if (initialItemId) await openItemById(initialItemId)
})

watch([selectedSubscriptionId, scope], () => { selectedItem.value = undefined; void loadItems(true) })
watch(() => queryValue(route.query.item), (itemId, previous) => {
  if (itemId && itemId !== previous && itemId !== selectedItem.value?.id) void openItemById(itemId)
})

async function loadStatus() {
  try { status.value = await rssApi.getStatus() } catch (cause) { error.value = messageFrom(cause) }
}

async function loadSubscriptions() {
  try { subscriptions.value = await rssApi.getSubscriptions() } catch (cause) { error.value = messageFrom(cause) }
}

async function loadItems(reset: boolean) {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const response = await rssApi.getItems({
      subscriptionId: selectedSubscriptionId.value || undefined,
      read: scope.value === 'unread' ? false : undefined,
      favorite: scope.value === 'favorite' ? true : undefined,
      offset: reset ? 0 : items.value.length,
      limit: 100
    })
    items.value = reset ? response.items : [...items.value, ...response.items]
    total.value = response.total
  } catch (cause) { error.value = messageFrom(cause) }
  finally { loading.value = false }
}

async function addSubscription() {
  if (!addForm.url.trim() || syncing.value) return
  syncing.value = true
  error.value = ''
  try {
    const tags = addForm.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
    const result = await rssApi.createSubscription({ url: addForm.url.trim(), title: addForm.title.trim() || undefined, tags, fetchNow: true })
    showAdd.value = false
    addForm.url = ''; addForm.title = ''; addForm.tags = ''
    await Promise.all([loadSubscriptions(), loadStatus(), loadItems(true)])
    selectedSubscriptionId.value = result.subscription.id
  } catch (cause) { error.value = messageFrom(cause) }
  finally { syncing.value = false }
}

async function fetchAll() {
  syncing.value = true
  error.value = ''
  try { await rssApi.fetchAll(true); await Promise.all([loadSubscriptions(), loadStatus(), loadItems(true)]) }
  catch (cause) { error.value = messageFrom(cause) }
  finally { syncing.value = false }
}

async function fetchOne(subscription: RssSubscription, event: Event) {
  event.stopPropagation()
  syncing.value = true
  error.value = ''
  try { await rssApi.fetchSubscription(subscription.id); await Promise.all([loadSubscriptions(), loadStatus(), loadItems(true)]) }
  catch (cause) { error.value = messageFrom(cause) }
  finally { syncing.value = false }
}

async function deleteSubscription(subscription: RssSubscription, event: Event) {
  event.stopPropagation()
  if (!window.confirm(`确定删除订阅“${subscription.title}”及其本地条目吗？`)) return
  try {
    await rssApi.deleteSubscription(subscription.id)
    if (selectedSubscriptionId.value === subscription.id) selectedSubscriptionId.value = ''
    await Promise.all([loadSubscriptions(), loadStatus(), loadItems(true)])
  } catch (cause) { error.value = messageFrom(cause) }
}

async function openItem(summary: RssItemSummary) {
  await openItemById(summary.id)
}

async function openItemById(id: string) {
  loadingDetail.value = true
  error.value = ''
  try {
    let item = await rssApi.getItem(id)
    if (!item.read) item = await rssApi.updateItem(item.id, { read: true })
    selectedItem.value = item
    const listItem = items.value.find((entry) => entry.id === item.id)
    if (listItem) listItem.read = true
    await loadStatus()
  } catch (cause) { error.value = messageFrom(cause) }
  finally { loadingDetail.value = false }
}

async function toggleFavorite() {
  if (!selectedItem.value) return
  try {
    selectedItem.value = await rssApi.updateItem(selectedItem.value.id, { favorite: !selectedItem.value.favorite })
    const listItem = items.value.find((entry) => entry.id === selectedItem.value?.id)
    if (listItem && selectedItem.value) listItem.favorite = selectedItem.value.favorite
  } catch (cause) { error.value = messageFrom(cause) }
}

async function openExternal(url?: string) {
  if (!url) return
  let safeUrl: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Unsupported protocol')
    safeUrl = parsed.toString()
  } catch {
    error.value = '原文链接不是安全的 HTTP(S) 地址'
    return
  }
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(safeUrl)
  } catch {
    window.open(safeUrl, '_blank', 'noopener,noreferrer')
  }
}

function subscriptionTitle(id: string) {
  return subscriptions.value.find((item) => item.id === id)?.title || '未知订阅'
}

function formatDate(timestamp?: number) {
  if (!timestamp) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误'
}

function queryValue(value: unknown) {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <header class="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-outline-variant/25 px-5 py-4 md:px-7">
      <div>
        <div class="flex items-center gap-2">
          <Rss class="h-5 w-5 text-primary flex-shrink-0" :stroke-width="2" />
          <h2 class="font-headline text-2xl font-bold">RSS 订阅</h2>
        </div>
        <p class="mt-1 text-xs text-secondary">
          {{ status?.subscriptionCount || 0 }} 个订阅 · {{ status?.unreadCount || 0 }} 条未读 · 
          <span :class="status?.encryptedAtRest ? 'text-primary' : 'text-tertiary'">{{ status?.encryptedAtRest ? '数据已加密' : '数据未加密' }}</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button class="toolbar-button" :disabled="syncing" title="抓取全部订阅" @click="fetchAll">
          <RotateCw class="h-4 w-4" :class="{ 'animate-spin': syncing }" :stroke-width="2" />
        </button>
        <button class="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-on-primary" @click="showAdd = true">
          <Plus class="h-4 w-4" :stroke-width="2.2" />
          <span>添加订阅</span>
        </button>
      </div>
    </header>

    <div v-if="error" class="mx-4 mt-3 flex flex-shrink-0 items-start gap-2 rounded-xl bg-error-container/60 p-3 text-sm text-on-error-container">
      <AlertCircle class="h-4 w-4 text-on-error-container flex-shrink-0 mt-0.5" :stroke-width="2" />
      <span class="min-w-0 flex-1">{{ error }}</span>
    </div>
    <div v-if="status?.resourceSyncError" class="mx-4 mt-3 flex flex-shrink-0 items-start gap-2 rounded-xl bg-tertiary-fixed/60 p-3 text-xs text-on-tertiary-fixed-variant">
      <AlertTriangle class="h-4 w-4 text-tertiary-fixed flex-shrink-0 mt-0.5" :stroke-width="2" />
      <span>RSS 已保存，但全局搜索索引同步失败：{{ status.resourceSyncError }}</span>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_minmax(320px,380px)_1fr]">
      <aside class="hidden min-h-0 flex-col border-r border-outline-variant/25 bg-surface-container-low/50 md:flex">
        <div class="p-3">
          <button class="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-bold" :class="!selectedSubscriptionId ? 'bg-primary-container text-on-primary-container' : 'text-secondary hover:bg-surface-container-high'" @click="selectedSubscriptionId = ''">
            <span class="flex items-center gap-2">
              <Layers class="h-4 w-4" :stroke-width="2" />
              <span>全部订阅</span>
            </span>
            <span>{{ status?.itemCount || 0 }}</span>
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <button v-for="subscription in subscriptions" :key="subscription.id" class="group mb-1 w-full rounded-xl p-3 text-left" :class="selectedSubscriptionId === subscription.id ? 'bg-primary-container text-on-primary-container' : 'text-on-surface hover:bg-surface-container-high'" @click="selectedSubscriptionId = subscription.id">
            <div class="flex items-start justify-between gap-2"><span class="line-clamp-2 text-xs font-bold">{{ subscription.title }}</span><span class="h-2 w-2 flex-shrink-0 rounded-full" :class="subscription.failureCount ? 'bg-error' : subscription.enabled ? 'bg-primary' : 'bg-outline'"></span></div>
            <p class="mt-1 truncate text-[10px] opacity-65">{{ subscription.url }}</p>
            <div class="mt-2 hidden items-center gap-1 group-hover:flex">
              <button class="rounded p-1 hover:bg-surface-bright/50" title="立即抓取" @click="fetchOne(subscription, $event)">
                <RotateCw class="h-3.5 w-3.5" :stroke-width="2" />
              </button>
              <button class="rounded p-1 text-error hover:bg-error-container/40" title="删除订阅" @click="deleteSubscription(subscription, $event)">
                <Trash2 class="h-3.5 w-3.5" :stroke-width="2" />
              </button>
            </div>
          </button>
          <div v-if="!subscriptions.length" class="p-5 text-center text-xs text-secondary">还没有订阅源</div>
        </div>
      </aside>

      <section class="flex min-h-0 flex-col border-r border-outline-variant/25" :class="{ 'hidden md:flex': selectedItem }">
        <div class="flex flex-shrink-0 items-center gap-1 border-b border-outline-variant/20 p-3"><button v-for="item in [{id:'unread',label:'未读'},{id:'all',label:'全部'},{id:'favorite',label:'收藏'}]" :key="item.id" class="flex-1 rounded-lg px-2 py-1.5 text-xs font-bold" :class="scope === item.id ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container-high'" @click="scope = item.id as typeof scope">{{ item.label }}</button></div>
        <select v-model="selectedSubscriptionId" class="m-3 rounded-xl border-outline-variant/30 bg-surface-bright text-xs font-bold md:hidden"><option value="">全部订阅</option><option v-for="subscription in subscriptions" :key="subscription.id" :value="subscription.id">{{ subscription.title }}</option></select>
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <button v-for="item in items" :key="item.id" class="mb-2 w-full rounded-xl border p-4 text-left transition" :class="selectedItem?.id === item.id ? 'border-primary/40 bg-primary-container text-on-primary-container' : item.read ? 'border-transparent bg-surface-container-low/60 text-secondary hover:bg-surface-container-high' : 'border-outline-variant/20 bg-surface-bright text-on-surface hover:border-primary/25'" @click="openItem(item)">
            <div class="flex items-start gap-2">
              <span v-if="!item.read" class="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary"></span>
              <h3 class="line-clamp-2 min-w-0 flex-1 text-sm font-bold">{{ item.title }}</h3>
              <Star v-if="item.favorite" class="h-4 w-4 fill-amber-500 text-amber-500 flex-shrink-0" :stroke-width="2" />
            </div>
            <p class="mt-2 line-clamp-2 text-xs leading-5 opacity-70">{{ item.summary || '无摘要' }}</p><div class="mt-2 flex items-center justify-between text-[10px] opacity-65"><span class="truncate">{{ subscriptionTitle(item.subscriptionId) }}</span><time>{{ formatDate(item.publishedAt || item.updatedAt || item.fetchedAt) }}</time></div>
          </button>
          <button v-if="hasMore" class="w-full rounded-xl border border-outline-variant/30 py-2 text-xs font-bold text-primary" :disabled="loading" @click="loadItems(false)">{{ loading ? '加载中…' : '加载更多' }}</button>
          <div v-if="!loading && !items.length" class="flex min-h-60 flex-col items-center justify-center text-center text-secondary">
            <Inbox class="h-10 w-10 text-outline/50 mb-2" :stroke-width="1.5" />
            <p class="text-sm font-bold">当前列表为空</p>
          </div>
        </div>
      </section>

      <main class="min-h-0 flex-col" :class="selectedItem ? 'flex' : 'hidden md:flex'">
        <div v-if="loadingDetail" class="flex flex-1 items-center justify-center text-secondary">
          <Loader2 class="mr-2 h-4 w-4 animate-spin" :stroke-width="2.5" />读取文章…
        </div>
        <div v-else-if="selectedItem" class="flex min-h-0 flex-1 flex-col">
          <header class="flex items-start justify-between gap-3 border-b border-outline-variant/20 p-4 md:p-6">
            <button class="toolbar-button flex-shrink-0 md:hidden" aria-label="返回文章列表" @click="selectedItem = undefined">
              <ArrowLeft class="h-4 w-4" :stroke-width="2" />
            </button>
            <div class="min-w-0 flex-1">
              <p class="text-xs font-bold text-primary">{{ subscriptionTitle(selectedItem.subscriptionId) }}</p>
              <h1 class="mt-2 font-headline text-2xl font-bold leading-tight">{{ selectedItem.title }}</h1>
              <p class="mt-2 text-xs text-secondary">{{ selectedItem.author || '未知作者' }} · {{ formatDate(selectedItem.publishedAt || selectedItem.updatedAt) }}</p>
            </div>
            <div class="flex gap-1">
              <button class="toolbar-button" :class="selectedItem.favorite ? 'text-amber-500' : ''" title="收藏" @click="toggleFavorite">
                <Star class="h-4 w-4" :class="{ 'fill-amber-500 text-amber-500': selectedItem.favorite }" :stroke-width="2" />
              </button>
              <button class="toolbar-button" :disabled="!selectedItem.link" title="打开原文" @click="openExternal(selectedItem.link)">
                <ExternalLink class="h-4 w-4" :stroke-width="2" />
              </button>
            </div>
          </header>
          <article class="min-h-0 flex-1 overflow-y-auto p-6">
            <p v-if="selectedItem.summary && selectedItem.summary !== selectedItem.content" class="mb-5 rounded-xl bg-surface-container-low p-4 text-sm leading-6 text-secondary">{{ selectedItem.summary }}</p>
            <div class="whitespace-pre-wrap text-[15px] leading-8 text-on-surface">{{ selectedItem.content || selectedItem.summary || '该条目没有可显示的正文' }}</div>
          </article>
        </div>
        <div v-else class="flex flex-1 flex-col items-center justify-center text-center text-secondary">
          <Newspaper class="mb-3 h-10 w-10 text-outline/50" :stroke-width="1.5" />
          <h3 class="font-headline text-xl font-bold text-on-surface">选择一篇文章开始阅读</h3>
        </div>
      </main>
    </div>

    <Teleport to="body">
      <div v-if="showAdd" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4" @click.self="showAdd = false">
        <form class="w-full max-w-lg rounded-xl bg-background p-6 shadow-2xl" @submit.prevent="addSubscription">
          <div class="flex items-center justify-between">
            <h3 class="font-headline text-xl font-bold">添加 RSS/Atom 订阅</h3>
            <button type="button" class="toolbar-button" @click="showAdd = false">
              <X class="h-4 w-4" :stroke-width="2" />
            </button>
          </div>
          <label class="mt-5 block text-xs font-bold text-secondary">订阅地址<input v-model="addForm.url" required type="url" class="mt-2 w-full rounded-xl border-outline-variant/30 bg-surface-bright focus:border-primary focus:ring-primary/20" placeholder="https://example.com/feed.xml" /></label>
          <label class="mt-4 block text-xs font-bold text-secondary">自定义名称（可选）<input v-model="addForm.title" maxlength="300" class="mt-2 w-full rounded-xl border-outline-variant/30 bg-surface-bright focus:border-primary focus:ring-primary/20" /></label>
          <label class="mt-4 block text-xs font-bold text-secondary">标签（逗号分隔）<input v-model="addForm.tags" class="mt-2 w-full rounded-xl border-outline-variant/30 bg-surface-bright focus:border-primary focus:ring-primary/20" placeholder="技术, 设计" /></label>
          <div class="mt-6 flex justify-end gap-2">
            <button type="button" class="rounded-xl px-4 py-2 text-sm font-bold text-secondary" @click="showAdd = false">取消</button>
            <button type="submit" class="rounded-xl bg-primary px-5 py-2 text-sm font-bold text-on-primary disabled:opacity-40" :disabled="syncing || !addForm.url.trim()">{{ syncing ? '验证并抓取中…' : '添加并抓取' }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.toolbar-button { @apply flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-surface-container-high hover:text-primary disabled:opacity-40; }
</style>
