<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import {
  SquarePen,
  FilePlus,
  Plus,
  AlertCircle,
  FolderX,
  FileText,
  Loader2,
  ArrowLeft,
  ShieldAlert,
  Eye,
  Undo2,
  Trash2,
  CheckSquare,
  Square,
  X
} from 'lucide-vue-next'
import { blogApi } from '../services/blogApi'
import type { BlogDraft, BlogDraftSummary, BlogPrivacy, BlogStatus, PrivacyFinding } from '../shared/blog'

const route = useRoute()
const drafts = ref<BlogDraftSummary[]>([])
const selected = ref<BlogDraft>()
const status = ref<BlogStatus>()
const findings = ref<PrivacyFinding[]>([])
const acceptedFindingIds = ref<string[]>([])
const previewHtml = ref('')
const previewOpen = ref(false)
const loading = ref(false)
const saving = ref(false)
const publishing = ref(false)
const error = ref('')
const importNoteId = ref('')
const showImport = ref(false)
const form = reactive({ title: '', slug: '', excerpt: '', content: '', tags: '', privacy: 'private' as BlogPrivacy })
const savedSnapshot = ref('')

const isDirty = computed(() => Boolean(selected.value) && snapshotValue() !== savedSnapshot.value)
const publishDirty = computed(() => Boolean(selected.value?.status === 'published' && selected.value.lastPublishedAt && selected.value.updatedAt > selected.value.lastPublishedAt))
const highFindings = computed(() => findings.value.filter((item) => item.severity === 'high'))
const allHighAccepted = computed(() => highFindings.value.every((item) => acceptedFindingIds.value.includes(item.id)))

onMounted(async () => {
  window.addEventListener('keydown', handleShortcut)
  await refresh()
  const draftId = queryValue(route.query.draft)
  if (draftId) await openDraftById(draftId)
})
onBeforeUnmount(() => window.removeEventListener('keydown', handleShortcut))
onBeforeRouteLeave(() => allowDiscard())
watch(() => queryValue(route.query.draft), (draftId, previous) => {
  if (draftId && draftId !== previous && draftId !== selected.value?.id) void openDraftById(draftId)
})

async function refresh() {
  loading.value = true; error.value = ''
  try { [status.value, drafts.value] = await Promise.all([blogApi.getStatus(), blogApi.getDrafts()]) }
  catch (cause) { error.value = messageFrom(cause) }
  finally { loading.value = false }
}

async function selectDraft(summary: BlogDraftSummary) {
  if (selected.value?.id === summary.id) return
  if (!allowDiscard()) return
  loading.value = true; error.value = ''
  try { applyDraft(await blogApi.getDraft(summary.id)) }
  catch (cause) { error.value = messageFrom(cause) }
  finally { loading.value = false }
}

async function openDraftById(id: string) {
  const summary = drafts.value.find((draft) => draft.id === id)
  if (summary) {
    await selectDraft(summary)
    return
  }
  if (!allowDiscard()) return
  loading.value = true
  error.value = ''
  try { applyDraft(await blogApi.getDraft(id)) }
  catch (cause) { error.value = messageFrom(cause) }
  finally { loading.value = false }
}

async function createDraft() {
  if (!allowDiscard()) return
  saving.value = true; error.value = ''
  try {
    const draft = await blogApi.createDraft({ title: '新博客草稿', content: '', privacy: 'private' })
    drafts.value = [draft, ...drafts.value]
    applyDraft(draft)
  } catch (cause) { error.value = messageFrom(cause) }
  finally { saving.value = false }
}

async function importFromXiaomi() {
  const noteId = importNoteId.value.trim()
  if (!/^\d{8,32}$/.test(noteId)) { error.value = '请输入正确的小米笔记 ID'; return }
  saving.value = true; error.value = ''
  try {
    const draft = await blogApi.createFromXiaomi(noteId)
    drafts.value = [draft, ...drafts.value]
    applyDraft(draft); showImport.value = false; importNoteId.value = ''
  } catch (cause) { error.value = messageFrom(cause) }
  finally { saving.value = false }
}

async function save() {
  if (!selected.value || !isDirty.value || saving.value) return selected.value
  saving.value = true; error.value = ''
  try {
    const draft = await blogApi.updateDraft(selected.value.id, {
      title: form.title.trim(), slug: form.slug.trim(), excerpt: form.excerpt.trim(), content: form.content,
      tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean), privacy: form.privacy
    })
    applyDraft(draft); upsertSummary(draft); return draft
  } catch (cause) { error.value = messageFrom(cause); return undefined }
  finally { saving.value = false }
}

async function scan() {
  const draft = await save()
  if (!draft) return
  try {
    const nextFindings = await blogApi.scan(draft.id)
    const nextIds = new Set(nextFindings.map((item) => item.id))
    findings.value = nextFindings
    acceptedFindingIds.value = acceptedFindingIds.value.filter((id) => nextIds.has(id))
  }
  catch (cause) { error.value = messageFrom(cause) }
}

async function preview() {
  const draft = await save()
  if (!draft) return
  try {
    const result = await blogApi.preview(draft.id)
    previewHtml.value = result.html; findings.value = result.findings; previewOpen.value = true
  } catch (cause) { error.value = messageFrom(cause) }
}

async function publish() {
  const draft = await save()
  if (!draft) return
  if (form.privacy !== 'public') { error.value = '发布前必须将隐私级别改为“公开级”'; return }
  await scan()
  if (highFindings.value.length && !allHighAccepted.value) {
    error.value = '检测到高风险隐私信息。确认每一项后才能发布。'
    return
  }
  publishing.value = true; error.value = ''
  try {
    const result = await blogApi.publish(draft.id, acceptedFindingIds.value)
    applyDraft(result.draft); upsertSummary(result.draft); await refresh()
  } catch (cause) { error.value = messageFrom(cause) }
  finally { publishing.value = false }
}

async function withdraw() {
  if (!selected.value || !window.confirm('确定撤回已发布文章吗？文件会移动到 .terra-trash。')) return
  publishing.value = true; error.value = ''
  try { const result = await blogApi.withdraw(selected.value.id); applyDraft(result.draft); upsertSummary(result.draft); await refresh() }
  catch (cause) { error.value = messageFrom(cause) }
  finally { publishing.value = false }
}

async function removeDraft() {
  if (!selected.value || !window.confirm('确定删除这个本地草稿吗？')) return
  try { await blogApi.deleteDraft(selected.value.id); drafts.value = drafts.value.filter((item) => item.id !== selected.value?.id); selected.value = undefined }
  catch (cause) { error.value = messageFrom(cause) }
}

function applyDraft(draft: BlogDraft) {
  selected.value = draft
  form.title = draft.title; form.slug = draft.slug; form.excerpt = draft.excerpt; form.content = draft.content; form.tags = draft.tags.join(', '); form.privacy = draft.privacy
  findings.value = []; acceptedFindingIds.value = []; previewOpen.value = false
  savedSnapshot.value = snapshotValue()
}

function upsertSummary(draft: BlogDraft) {
  const { content: _content, ...summary } = draft
  drafts.value = [summary, ...drafts.value.filter((item) => item.id !== draft.id)]
}

function toggleAccepted(id: string) {
  acceptedFindingIds.value = acceptedFindingIds.value.includes(id) ? acceptedFindingIds.value.filter((item) => item !== id) : [...acceptedFindingIds.value, id]
}

function allowDiscard() { return !isDirty.value || window.confirm('当前博客草稿尚未保存，确定放弃修改吗？') }
function snapshotValue() { return JSON.stringify(form) }
function handleShortcut(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() } }
function statusLabel(value: string) { return ({ draft: '草稿', published: '已发布', withdrawn: '已撤回' } as Record<string, string>)[value] || value }
function severityLabel(value: string) { return ({ high: '高风险', medium: '中风险', low: '提示' } as Record<string, string>)[value] || value }
function formatDate(value: number) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function messageFrom(error: unknown) { return error instanceof Error ? error.message : '发生未知错误' }
function queryValue(value: unknown) { if (typeof value === 'string') return value; if (Array.isArray(value) && typeof value[0] === 'string') return value[0]; return '' }
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <header class="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-outline-variant/25 px-5 py-4 md:px-7">
      <div>
        <div class="flex items-center gap-2">
          <SquarePen class="h-5 w-5 text-primary flex-shrink-0" :stroke-width="2" />
          <h2 class="font-headline text-2xl font-bold">个人博客</h2>
        </div>
        <p class="mt-1 text-xs text-secondary">
          {{ status?.draftCount || 0 }} 个草稿 · {{ status?.publishedCount || 0 }} 篇已发布 · 
          <span :class="status?.storage.encryptedAtRest ? 'text-primary' : 'text-tertiary'">{{ status?.storage.encryptedAtRest ? '草稿已加密' : '草稿未加密' }}</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button class="toolbar-button" title="从小米笔记导入" @click="showImport = true">
          <FilePlus class="h-4 w-4" :stroke-width="2" />
        </button>
        <button class="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-on-primary" @click="createDraft">
          <Plus class="h-4 w-4" :stroke-width="2.2" />
          <span>新建草稿</span>
        </button>
      </div>
    </header>

    <div v-if="error" class="mx-4 mt-3 flex flex-shrink-0 items-start gap-2 rounded-xl bg-error-container/60 p-3 text-sm text-on-error-container">
      <AlertCircle class="h-4 w-4 text-on-error-container flex-shrink-0 mt-0.5" :stroke-width="2" />
      <span class="min-w-0 flex-1">{{ error }}</span>
    </div>
    <div v-if="status && !status.adapter.configured" class="mx-4 mt-3 flex flex-shrink-0 items-start gap-2 rounded-xl bg-tertiary-fixed/60 p-3 text-xs text-on-tertiary-fixed-variant">
      <FolderX class="h-4 w-4 text-tertiary-fixed flex-shrink-0 mt-0.5" :stroke-width="2" />
      <span>博客发布目录未配置。草稿和预览可用，发布前请设置 TERRA_BLOG_CONTENT_DIR。</span>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_1fr]">
      <aside class="min-h-0 border-r border-outline-variant/25 bg-surface-container-low/45" :class="{ 'hidden md:block': selected }">
        <div class="h-full overflow-y-auto p-3">
          <button v-for="draft in drafts" :key="draft.id" class="mb-2 w-full rounded-xl border p-4 text-left" :class="selected?.id === draft.id ? 'border-primary/40 bg-primary-container text-on-primary-container' : 'border-transparent bg-surface-bright hover:border-outline-variant/40'" @click="selectDraft(draft)">
            <div class="flex items-start justify-between gap-2">
              <h3 class="line-clamp-2 text-sm font-bold">{{ draft.title }}</h3>
              <span class="rounded-full px-2 py-0.5 text-[9px] font-bold" :class="draft.status === 'published' ? 'bg-primary text-on-primary' : draft.status === 'withdrawn' ? 'bg-surface-container-high text-secondary' : 'bg-secondary-container text-on-secondary-container'">{{ statusLabel(draft.status) }}</span>
            </div>
            <p class="mt-2 line-clamp-2 text-xs text-secondary">{{ draft.excerpt || draft.slug }}</p>
            <div class="mt-2 flex items-center justify-between text-[10px] text-secondary">
              <span>{{ draft.privacy === 'public' ? '公开级' : draft.privacy === 'secret' ? '机密' : '私人' }}</span>
              <time>{{ formatDate(draft.updatedAt) }}</time>
            </div>
          </button>
          <div v-if="!drafts.length" class="flex min-h-60 flex-col items-center justify-center text-center text-secondary">
            <FileText class="h-10 w-10 text-outline/50 mb-2" :stroke-width="1.5" />
            <p class="text-sm font-bold">还没有博客草稿</p>
          </div>
        </div>
      </aside>

      <main class="min-h-0" :class="selected ? 'block' : 'hidden md:block'">
        <div v-if="loading" class="flex h-full items-center justify-center text-secondary">
          <Loader2 class="mr-2 h-4 w-4 animate-spin" :stroke-width="2.5" />加载中…
        </div>
        <div v-else-if="selected" class="flex h-full min-h-0 flex-col">
          <div class="flex flex-shrink-0 items-center justify-between gap-2 border-b border-outline-variant/20 px-4 py-2">
            <div class="flex items-center gap-1">
              <button class="toolbar-button md:hidden" @click="selected = undefined">
                <ArrowLeft class="h-4 w-4" :stroke-width="2" />
              </button>
              <span class="text-xs font-bold text-secondary">{{ statusLabel(selected.status) }}<span v-if="isDirty" class="ml-2 text-tertiary">未保存</span><span v-else-if="publishDirty" class="ml-2 text-tertiary">发布后有修改</span></span>
            </div>
            <div class="flex items-center gap-1">
              <button class="toolbar-button" title="隐私扫描" @click="scan">
                <ShieldAlert class="h-4 w-4" :stroke-width="2" />
              </button>
              <button class="toolbar-button" title="预览" @click="preview">
                <Eye class="h-4 w-4" :stroke-width="2" />
              </button>
              <button v-if="selected.status === 'published'" class="toolbar-button text-tertiary" title="撤回" @click="withdraw">
                <Undo2 class="h-4 w-4" :stroke-width="2" />
              </button>
              <button v-if="selected.status !== 'published'" class="toolbar-button text-error" title="删除草稿" @click="removeDraft">
                <Trash2 class="h-4 w-4" :stroke-width="2" />
              </button>
              <button class="rounded-xl border border-outline-variant/40 px-3 py-2 text-xs font-bold text-primary disabled:opacity-40" :disabled="!isDirty || saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
              <button class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-on-primary disabled:opacity-40" :disabled="publishing || !status?.adapter.configured" @click="publish">{{ publishing ? '发布中…' : selected.status === 'published' ? '更新发布' : '发布' }}</button>
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-5 md:p-7">
            <div class="grid gap-4 md:grid-cols-2">
              <label class="text-xs font-bold text-secondary md:col-span-2">标题<input v-model="form.title" maxlength="300" class="mt-2 w-full rounded-xl border-outline-variant/30 bg-surface-bright font-headline text-xl font-bold focus:border-primary focus:ring-primary/20" /></label>
              <label class="text-xs font-bold text-secondary">Slug<input v-model="form.slug" maxlength="120" class="mt-2 w-full rounded-xl border-outline-variant/30 bg-surface-bright font-mono text-sm focus:border-primary focus:ring-primary/20" /></label>
              <label class="text-xs font-bold text-secondary">隐私级别<select v-model="form.privacy" class="mt-2 w-full rounded-xl border-outline-variant/30 bg-surface-bright text-sm focus:border-primary focus:ring-primary/20"><option value="private">私人</option><option value="secret">机密</option><option value="public">公开级（允许发布）</option></select></label>
              <label class="text-xs font-bold text-secondary md:col-span-2">摘要<textarea v-model="form.excerpt" maxlength="1000" rows="2" class="mt-2 w-full rounded-xl border-outline-variant/30 bg-surface-bright text-sm focus:border-primary focus:ring-primary/20"></textarea></label>
              <label class="text-xs font-bold text-secondary md:col-span-2">标签（逗号分隔）<input v-model="form.tags" class="mt-2 w-full rounded-xl border-outline-variant/30 bg-surface-bright text-sm focus:border-primary focus:ring-primary/20" /></label>
              <label class="text-xs font-bold text-secondary md:col-span-2">Markdown 正文<textarea v-model="form.content" maxlength="300000" rows="22" class="mt-2 w-full rounded-xl border-outline-variant/30 bg-surface-bright font-mono text-sm leading-6 focus:border-primary focus:ring-primary/20" placeholder="# 标题"></textarea></label>
            </div>
            <section v-if="findings.length" class="mt-5 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
              <div class="flex items-center justify-between">
                <h3 class="font-headline text-base font-bold">隐私扫描结果</h3>
                <span class="text-xs text-secondary">{{ findings.length }} 项</span>
              </div>
              <div class="mt-3 space-y-2">
                <button v-for="finding in findings" :key="finding.id" class="flex w-full items-start gap-3 rounded-xl border p-3 text-left" :class="finding.severity === 'high' ? 'border-error/30 bg-error-container/40' : 'border-outline-variant/30 bg-surface-bright'" @click="toggleAccepted(finding.id)">
                  <CheckSquare v-if="acceptedFindingIds.includes(finding.id)" class="h-4.5 w-4.5 text-primary flex-shrink-0" :stroke-width="2" />
                  <Square v-else class="h-4.5 w-4.5 flex-shrink-0" :class="finding.severity === 'high' ? 'text-error' : 'text-tertiary'" :stroke-width="1.8" />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-bold">{{ finding.message }}</span>
                      <span class="rounded-full px-2 py-0.5 text-[9px] font-bold">{{ severityLabel(finding.severity) }}</span>
                    </div>
                    <code class="mt-1 block truncate text-[10px] text-secondary">{{ finding.preview }}</code>
                  </div>
                </button>
              </div>
              <p v-if="highFindings.length && !allHighAccepted" class="mt-3 text-xs font-bold text-error">高风险项必须逐项确认后才能发布。</p>
            </section>
          </div>
        </div>
        <div v-else class="flex h-full flex-col items-center justify-center text-center text-secondary">
          <FileText class="mb-3 h-10 w-10 text-outline/50" :stroke-width="1.5" />
          <h3 class="font-headline text-xl font-bold text-on-surface">选择或创建一个博客草稿</h3>
        </div>
      </main>
    </div>

    <Teleport to="body">
      <div v-if="previewOpen" class="fixed inset-0 z-[100] flex justify-end bg-black/25" @click.self="previewOpen = false">
        <aside class="flex h-full w-full max-w-3xl flex-col bg-background shadow-2xl">
          <header class="flex items-center justify-between border-b border-outline-variant/25 p-4">
            <h3 class="font-headline text-xl font-bold">安全预览</h3>
            <button class="toolbar-button" @click="previewOpen = false">
              <X class="h-4 w-4" :stroke-width="2" />
            </button>
          </header>
          <iframe class="min-h-0 flex-1 bg-white" sandbox="" :srcdoc="`<!doctype html><meta charset='utf-8'><style>body{max-width:760px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui;color:#222}pre,code{background:#f3f3f3;padding:2px 5px;border-radius:4px}img{max-width:100%}a{color:#416463}</style>${previewHtml}`"></iframe>
        </aside>
      </div>
      <div v-if="showImport" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4" @click.self="showImport = false">
        <form class="w-full max-w-md rounded-xl bg-background p-6 shadow-2xl" @submit.prevent="importFromXiaomi">
          <h3 class="font-headline text-xl font-bold">从小米笔记生成草稿</h3>
          <p class="mt-2 text-xs text-secondary">输入小米笔记 ID，标题和纯文本正文会复制到新的私人草稿。</p>
          <input v-model="importNoteId" required class="mt-4 w-full rounded-xl border-outline-variant/30 bg-surface-bright font-mono" placeholder="5099…" />
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="px-4 py-2 text-sm font-bold text-secondary" @click="showImport = false">取消</button>
            <button type="submit" class="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary" :disabled="saving">{{ saving ? '导入中…' : '生成草稿' }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.toolbar-button { @apply flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-surface-container-high hover:text-primary disabled:opacity-40; }
</style>
