<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useIsMobile } from '../composables/useIsMobile'
import { useXiaomiNotesStore } from '../store/xiaomiNotes'
import type { NotePrivacyLevel, XiaomiNote, XiaomiNoteHistoryReason } from '../shared/xiaomiNote'

type EditorMode = 'empty' | 'new' | 'edit'
type OpenNoteTab = { id: string; title: string }
type OutlineItem = { level: 1 | 2; title: string; line: number; offset: number }

const route = useRoute()
const router = useRouter()
const store = useXiaomiNotesStore()
const isMobile = useIsMobile()
const searchQuery = ref('')
const selectedFolder = ref('all')
const noteScope = ref<'active' | 'favorite' | 'archived'>('active')
const tagInput = ref('')
const editorMode = ref<EditorMode>('empty')
const draft = reactive({ title: '', content: '' })
const savedSnapshot = ref(JSON.stringify(draft))
const toast = ref('')
const contentEditor = ref<HTMLTextAreaElement>()
const workspaceRoot = ref<HTMLElement>()
const secondarySidebarWidth = ref(360)
const secondarySidebarHidden = ref(false)
const tabsVisible = ref(true)
const outlineVisible = ref(true)
const outlineLevel = ref<1 | 2>(1)
const openTabs = ref<OpenNoteTab[]>([])
const historyOpen = ref(false)
const historyMode = ref<'current' | 'archive'>('current')
const archiveSelectedNoteId = ref('')
const historyDetailVisible = ref(false)
let toastTimer = 0
let resizeFrame = 0
let stopSecondaryDrag: (() => void) | undefined
let openRequestId = 0

const filteredNotes = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('zh-CN')
  return store.sortedNotes.filter((note) => {
    const metadata = store.metadata[note.id]
    const folderMatches = selectedFolder.value === 'all' || note.folderId === selectedFolder.value
    const scopeMatches = noteScope.value === 'favorite'
      ? Boolean(metadata?.favorite && !metadata?.archived)
      : noteScope.value === 'archived'
        ? Boolean(metadata?.archived)
        : !metadata?.archived
    const searchable = `${note.title}\n${note.preview}\n${metadata?.tags.join(' ') || ''}`
    const queryMatches = !query || searchable.toLocaleLowerCase('zh-CN').includes(query)
    return folderMatches && scopeMatches && queryMatches
  })
})

const folderOptions = computed(() => {
  const count = (id: string) => store.notes.filter((note) => note.folderId === id).length
  return [
    { id: 'all', title: '全部笔记', count: store.notes.length },
    { id: '0', title: '未分类', count: count('0') },
    ...store.folders.map((folder) => ({ ...folder, count: count(folder.id) }))
  ]
})

const outlineItems = computed<OutlineItem[]>(() => {
  let offset = 0
  return draft.content.split('\n').flatMap((line, index) => {
    const match = /^(#{1,2})\s+(.+?)\s*$/.exec(line)
    const item = match
      ? [{ level: match[1].length as 1 | 2, title: match[2], line: index, offset }]
      : []
    offset += line.length + 1
    return item
  })
})
const visibleOutlineItems = computed(() => outlineItems.value.filter((item) => item.level === outlineLevel.value))
const isDirty = computed(() => JSON.stringify(draft) !== savedSnapshot.value)
const selectedId = computed(() => store.selectedNote?.id)
const selectedMetadata = computed(() => {
  const noteId = selectedId.value
  return noteId ? store.metadata[noteId] || {
    noteId,
    favorite: false,
    archived: false,
    tags: [],
    privacy: 'private' as NotePrivacyLevel,
    createdAt: 0,
    updatedAt: 0
  } : undefined
})
const historyTargetId = computed(() => historyMode.value === 'current' ? selectedId.value : archiveSelectedNoteId.value || undefined)
const canSave = computed(() =>
  store.writable &&
  !store.saving &&
  Boolean(draft.title.trim() || draft.content.trim()) &&
  draft.title.length <= 200 &&
  draft.content.length <= 80_000
)

onMounted(() => {
  const savedWidth = Number(localStorage.getItem('terra_notes_secondary_sidebar_width'))
  if (Number.isFinite(savedWidth)) secondarySidebarWidth.value = clampSecondaryWidth(savedWidth)
  secondarySidebarHidden.value = localStorage.getItem('terra_notes_secondary_sidebar_hidden') === 'true'
  tabsVisible.value = localStorage.getItem('terra_notes_tabs_visible') !== 'false'
  outlineVisible.value = localStorage.getItem('terra_notes_outline_visible') !== 'false'
  try {
    const parsed = JSON.parse(localStorage.getItem('terra_notes_open_tabs') || '[]') as unknown
    if (Array.isArray(parsed)) {
      openTabs.value = parsed
        .filter((item): item is OpenNoteTab => Boolean(item && typeof item.id === 'string' && typeof item.title === 'string'))
        .slice(0, 10)
    }
  } catch {
    openTabs.value = []
  }
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('keydown', handleShortcut)
  window.addEventListener('resize', handleViewportResize)
  handleViewportResize()
  void store.initialize()
})

onBeforeUnmount(() => {
  stopSecondaryDrag?.()
  window.cancelAnimationFrame(resizeFrame)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleShortcut)
  window.removeEventListener('resize', handleViewportResize)
})

onBeforeRouteLeave(() => allowDiscard())

watch(
  () => route.query.new,
  async (value) => {
    if (value === '1') {
      await store.initialize()
      startNew()
      const query = { ...route.query }
      delete query.new
      void router.replace({ path: '/xiaomi-notes', query })
    }
  },
  { immediate: true }
)

watch(
  () => route.query.note,
  async (value) => {
    if (typeof value !== 'string' || !/^\d{8,32}$/.test(value)) return
    await store.initialize()
    await openNote(value, '加载中…')
    const query = { ...route.query }
    delete query.note
    void router.replace({ path: '/xiaomi-notes', query })
  },
  { immediate: true }
)

watch(() => draft.title, (title) => {
  if (!selectedId.value) return
  const tab = openTabs.value.find((item) => item.id === selectedId.value)
  if (tab) {
    tab.title = title.trim() || '无标题笔记'
    persistTabs()
  }
})

function snapshot() {
  savedSnapshot.value = JSON.stringify({ title: draft.title, content: draft.content })
}

function resetDraft(note?: XiaomiNote) {
  draft.title = note?.title === '无标题笔记' ? '' : note?.title || ''
  draft.content = note?.content || ''
  snapshot()
}

function allowDiscard() {
  return !isDirty.value || window.confirm('当前修改尚未保存，确定放弃吗？')
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

function handleShortcut(event: KeyboardEvent) {
  const command = event.ctrlKey || event.metaKey
  if (command && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void saveNote()
  } else if (command && event.shiftKey && event.key.toLowerCase() === 'h') {
    event.preventDefault()
    void openHistory()
  } else if (command && event.key === '\\') {
    event.preventDefault()
    toggleSecondarySidebar()
  }
}

function startNew() {
  if (!store.writable) {
    showToast(store.status?.message || '小米笔记连接器当前不可写')
    return
  }
  if (!allowDiscard()) return
  openRequestId += 1
  store.clearSelection()
  historyOpen.value = false
  editorMode.value = 'new'
  resetDraft()
}

async function selectNote(note: XiaomiNote) {
  return openNote(note.id, note.title)
}

async function openNote(id: string, fallbackTitle = '加载中…') {
  if (selectedId.value === id && editorMode.value === 'edit') return
  if (!allowDiscard()) return
  const requestId = ++openRequestId
  editorMode.value = 'edit'
  historyOpen.value = false
  resetDraft({ id, title: fallbackTitle, content: '', tag: id, preview: '', createDate: 0, modifyDate: 0, colorId: 0, folderId: '0', status: 'normal', hasRichFormatting: false })
  const detail = await store.selectNote(id)
  if (requestId !== openRequestId) return
  if (detail) {
    resetDraft(detail)
    addOpenTab(detail)
    if (isMobile.value) secondarySidebarHidden.value = true
  } else {
    editorMode.value = 'empty'
    store.clearSelection()
    resetDraft()
  }
}

function closeEditor() {
  if (!allowDiscard()) return
  openRequestId += 1
  store.clearSelection()
  editorMode.value = 'empty'
  historyOpen.value = false
  resetDraft()
  if (isMobile.value) secondarySidebarHidden.value = false
}

async function saveNote() {
  if (!store.writable) {
    showToast(store.status?.message || '小米笔记连接器当前不可写')
    return
  }
  if (!canSave.value) return
  const payload = { title: draft.title.trim(), content: draft.content }
  const note = editorMode.value === 'new'
    ? await store.createNote(payload)
    : store.selectedNote
      ? await store.updateNote(store.selectedNote.id, payload)
      : undefined

  if (!note) return
  editorMode.value = 'edit'
  resetDraft(note)
  addOpenTab(note)
  showToast('已同步到小米笔记，旧版本已保存在 Terra 历史中')
}

async function deleteNote() {
  const note = store.selectedNote
  if (!note || store.saving || !store.writable) return
  if (!window.confirm(`确定将“${note.title}”移到小米笔记回收站吗？删除前会创建 Terra 历史快照。`)) return
  const deleted = await store.deleteNote(note.id)
  if (deleted) {
    removeTab(note.id)
    editorMode.value = 'empty'
    resetDraft()
    showToast('笔记已移到回收站，删除前版本已留存')
  }
}

async function refresh() {
  await store.refreshStatus()
  if (store.status?.configured) {
    await store.loadNotes(true, true)
    showToast(store.error ? '刷新失败' : '列表已刷新')
  }
}

function addOpenTab(note: XiaomiNote) {
  const tab = openTabs.value.find((item) => item.id === note.id)
  if (tab) tab.title = note.title
  else openTabs.value.push({ id: note.id, title: note.title })
  if (openTabs.value.length > 10) openTabs.value.shift()
  persistTabs()
}

function closeTab(id: string, event?: Event) {
  event?.stopPropagation()
  if (id === selectedId.value && !allowDiscard()) return
  const index = openTabs.value.findIndex((item) => item.id === id)
  if (index < 0) return
  openTabs.value.splice(index, 1)
  persistTabs()
  if (id !== selectedId.value) return
  const next = openTabs.value[Math.max(0, index - 1)] || openTabs.value[0]
  if (next) void openNote(next.id, next.title)
  else closeEditor()
}

function removeTab(id: string) {
  openTabs.value = openTabs.value.filter((item) => item.id !== id)
  persistTabs()
}

function persistTabs() {
  localStorage.setItem('terra_notes_open_tabs', JSON.stringify(openTabs.value.slice(0, 10)))
}

function toggleTabs() {
  tabsVisible.value = !tabsVisible.value
  localStorage.setItem('terra_notes_tabs_visible', String(tabsVisible.value))
}

function toggleOutline() {
  outlineVisible.value = !outlineVisible.value
  localStorage.setItem('terra_notes_outline_visible', String(outlineVisible.value))
}

function toggleSecondarySidebar() {
  secondarySidebarHidden.value = !secondarySidebarHidden.value
  localStorage.setItem('terra_notes_secondary_sidebar_hidden', String(secondarySidebarHidden.value))
}

function startSecondaryResize(event: PointerEvent) {
  if (event.button !== 0 || isMobile.value) return
  event.preventDefault()
  const startX = event.clientX
  const startWidth = secondarySidebarWidth.value
  document.body.classList.add('notes-resize-active')
  const move = (moveEvent: PointerEvent) => {
    secondarySidebarWidth.value = clampSecondaryWidth(startWidth + moveEvent.clientX - startX)
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    window.removeEventListener('blur', stop)
    document.body.classList.remove('notes-resize-active')
    localStorage.setItem('terra_notes_secondary_sidebar_width', String(Math.round(secondarySidebarWidth.value)))
    stopSecondaryDrag = undefined
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
  window.addEventListener('pointercancel', stop, { once: true })
  window.addEventListener('blur', stop, { once: true })
  stopSecondaryDrag = stop
}

function clampSecondaryWidth(width: number) {
  const workspaceWidth = workspaceRoot.value?.clientWidth || (typeof window === 'undefined' ? 980 : window.innerWidth)
  const workspaceMax = Math.max(280, workspaceWidth - 420)
  return Math.max(280, Math.min(560, workspaceMax, width))
}

function handleViewportResize() {
  window.cancelAnimationFrame(resizeFrame)
  resizeFrame = window.requestAnimationFrame(() => {
    if (!isMobile.value) secondarySidebarWidth.value = clampSecondaryWidth(secondarySidebarWidth.value)
  })
}

function insertHeading(level: 1 | 2) {
  const editor = contentEditor.value
  const prefix = level === 1 ? '# ' : '## '
  if (!editor) {
    draft.content += `${draft.content ? '\n' : ''}${prefix}`
    return
  }
  const start = editor.selectionStart
  const lineStart = draft.content.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const currentLine = draft.content.slice(lineStart, draft.content.indexOf('\n', start) === -1 ? undefined : draft.content.indexOf('\n', start))
  const stripped = currentLine.replace(/^#{1,2}\s+/, '')
  const lineEnd = lineStart + currentLine.length
  draft.content = `${draft.content.slice(0, lineStart)}${prefix}${stripped}${draft.content.slice(lineEnd)}`
  void nextTick(() => {
    const position = lineStart + prefix.length + stripped.length
    editor.focus()
    editor.setSelectionRange(position, position)
  })
}

function jumpToHeading(item: OutlineItem) {
  const editor = contentEditor.value
  if (!editor) return
  editor.focus()
  editor.setSelectionRange(item.offset, item.offset)
  editor.scrollTop = Math.max(0, item.line * 28 - 100)
}

async function openHistory() {
  if (!store.selectedNote) return
  historyMode.value = 'current'
  archiveSelectedNoteId.value = ''
  historyDetailVisible.value = false
  historyOpen.value = true
  await store.loadHistory(store.selectedNote.id)
}

async function openHistoryArchive() {
  historyMode.value = 'archive'
  archiveSelectedNoteId.value = ''
  historyDetailVisible.value = false
  store.clearHistory()
  historyOpen.value = true
  await store.loadHistoryArchive()
}

async function selectArchiveGroup(noteId: string) {
  archiveSelectedNoteId.value = noteId
  historyDetailVisible.value = false
  await store.loadHistory(noteId)
}

function backToArchiveGroups() {
  archiveSelectedNoteId.value = ''
  historyDetailVisible.value = false
  store.clearHistory()
}

function openHistoryVersion(noteId: string, entryId: string) {
  historyDetailVisible.value = true
  void store.loadHistoryVersion(noteId, entryId)
}

async function createCheckpoint() {
  if (!store.selectedNote || isDirty.value) return
  const created = await store.createCheckpoint(store.selectedNote.id)
  showToast(created ? '已创建手动历史快照' : '历史快照创建失败')
}

async function restoreHistory() {
  if (!store.selectedNote || !store.selectedHistory || !store.writable) return
  if (!allowDiscard()) return
  if (!window.confirm(`确定恢复到 ${formatFullDate(store.selectedHistory.capturedAt)} 的版本吗？当前云端版本也会先保存为历史。`)) return
  const restored = await store.restoreHistory(store.selectedNote.id, store.selectedHistory.id)
  if (restored) {
    resetDraft(restored)
    addOpenTab(restored)
    showToast('历史版本已恢复并同步到小米笔记')
  }
}

async function recreateHistoryVersion() {
  if (!store.selectedHistory || !store.writable) return
  if (!window.confirm('确定从这个 Terra 历史版本重建一条新的小米笔记吗？')) return
  const recreated = await store.recreateFromHistory(store.selectedHistory.id)
  if (recreated) {
    editorMode.value = 'edit'
    resetDraft(recreated)
    addOpenTab(recreated)
    historyOpen.value = false
    showToast('已从 Terra 历史重建为新的小米笔记')
  }
}

async function deleteSelectedHistory() {
  const entry = store.selectedHistory
  if (!entry || store.deletingHistory) return
  if (!window.confirm(`确定删除 ${formatFullDate(entry.capturedAt)} 的 Terra 历史版本吗？此操作不会修改小米云笔记。`)) return
  const deleted = await store.deleteHistoryVersion(entry.noteId, entry.id)
  if (!deleted) return
  if (isMobile.value) historyDetailVisible.value = false
  if (historyMode.value === 'archive' && store.history.length === 0) backToArchiveGroups()
  showToast('Terra 历史版本已删除')
}

async function clearHistoryGroup() {
  const noteId = historyTargetId.value
  if (!noteId || !store.history.length || store.deletingHistory) return
  if (!window.confirm(`确定清理这篇笔记的 ${store.history.length} 个 Terra 历史版本吗？此操作不可撤销，也不会修改小米云笔记。`)) return
  const removed = await store.clearNoteHistory(noteId)
  if (removed === undefined) return
  if (historyMode.value === 'archive') backToArchiveGroups()
  showToast(`已清理 ${removed} 个 Terra 历史版本`)
}

function historyReasonLabel(reason: XiaomiNoteHistoryReason) {
  return ({
    created: '创建版本',
    manual: '手动快照',
    before_update: '编辑前',
    before_delete: '删除前',
    before_restore: '恢复前',
    restored: '恢复结果'
  } as Record<XiaomiNoteHistoryReason, string>)[reason]
}

async function toggleFavorite() {
  if (!selectedId.value || !selectedMetadata.value) return
  await store.updateMetadata(selectedId.value, { favorite: !selectedMetadata.value.favorite })
}

async function toggleArchived() {
  if (!selectedId.value || !selectedMetadata.value) return
  const archived = !selectedMetadata.value.archived
  await store.updateMetadata(selectedId.value, { archived })
  showToast(archived ? '已归档到 Terra' : '已恢复到使用中列表')
}

async function addTag() {
  if (!selectedId.value || !selectedMetadata.value) return
  const tag = tagInput.value.trim().replace(/\s+/g, ' ')
  if (!tag) return
  const tags = Array.from(new Set([...selectedMetadata.value.tags, tag]))
  const updated = await store.updateMetadata(selectedId.value, { tags })
  if (updated) tagInput.value = ''
}

async function removeTag(tag: string) {
  if (!selectedId.value || !selectedMetadata.value) return
  await store.updateMetadata(selectedId.value, { tags: selectedMetadata.value.tags.filter((item) => item !== tag) })
}

async function updatePrivacy(event: Event) {
  if (!selectedId.value) return
  const privacy = (event.target as HTMLSelectElement).value as NotePrivacyLevel
  await store.updateMetadata(selectedId.value, { privacy })
}

function showToast(message: string) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = '' }, 2400)
}

function formatDate(timestamp: number) {
  if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

function formatFullDate(timestamp: number) {
  if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp))
}
</script>

<template>
  <div ref="workspaceRoot" class="relative flex h-full min-h-0 flex-col bg-background">
    <header class="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-outline-variant/25 bg-background/90 px-5 py-3 backdrop-blur-xl md:px-6">
      <div class="flex min-w-0 items-center gap-3">
        <button v-if="!isMobile" class="flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-surface-container-high hover:text-primary" :aria-label="secondarySidebarHidden ? '显示二级侧边栏' : '隐藏二级侧边栏'" @click="toggleSecondarySidebar">
          <span class="material-symbols-outlined text-[21px]">{{ secondarySidebarHidden ? 'right_panel_open' : 'left_panel_close' }}</span>
        </button>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">note_stack</span>
            <h2 class="truncate font-headline text-xl font-bold text-on-surface md:text-2xl">小米笔记</h2>
          </div>
          <p class="mt-0.5 hidden items-center gap-2 text-[11px] text-secondary sm:flex"><span>Terra 工作区 · 云端同步</span><span v-if="store.status?.historyStorage" class="font-bold" :class="store.status.historyStorage.encryptedAtRest ? 'text-primary' : 'text-tertiary'">{{ store.status.historyStorage.encryptedAtRest ? '历史已加密' : '历史未加密' }}</span><span v-if="store.status?.mode === 'readonly'" class="font-bold text-tertiary">只读模式</span><span v-else-if="store.status?.mode === 'credentials_invalid'" class="font-bold text-error">凭证失效</span><span v-else-if="store.status?.mode === 'circuit_open'" class="font-bold text-error">连接器熔断</span></p>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <button class="toolbar-button" :class="tabsVisible ? 'text-primary' : ''" :aria-label="tabsVisible ? '隐藏文档标签' : '显示文档标签'" @click="toggleTabs"><span class="material-symbols-outlined text-[20px]">tab</span></button>
        <button class="toolbar-button" :class="outlineVisible ? 'text-primary' : ''" :aria-label="outlineVisible ? '隐藏标题导航' : '显示标题导航'" @click="toggleOutline"><span class="material-symbols-outlined text-[20px]">toc</span></button>
        <button class="toolbar-button" aria-label="打开 Terra 历史归档" @click="openHistoryArchive"><span class="material-symbols-outlined text-[20px]">inventory_2</span></button>
        <button class="toolbar-button" :disabled="store.loading" aria-label="刷新笔记列表" @click="refresh"><span class="material-symbols-outlined text-[20px]" :class="{ 'animate-spin': store.loading }">refresh</span></button>
        <button class="flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-bold text-on-primary shadow-sm disabled:opacity-40" :disabled="!store.writable" @click="startNew"><span class="material-symbols-outlined text-[20px]">note_add</span><span class="hidden sm:inline">新建</span></button>
      </div>
    </header>

    <div v-if="store.status?.mode === 'readonly' || store.status?.mode === 'credentials_invalid' || store.status?.mode === 'circuit_open'" class="flex flex-shrink-0 items-start gap-2 border-b border-outline-variant/20 px-5 py-2.5 text-xs md:px-6" :class="store.status.mode === 'readonly' ? 'bg-tertiary-fixed/45 text-on-tertiary-fixed-variant' : 'bg-error-container/55 text-on-error-container'"><span class="material-symbols-outlined text-[18px]">{{ store.status.mode === 'readonly' ? 'lock' : store.status.mode === 'credentials_invalid' ? 'key_off' : 'cloud_off' }}</span><span>{{ store.status.message }}<span v-if="store.status.retryAfterSeconds">（约 {{ store.status.retryAfterSeconds }} 秒后可重试）</span></span></div>

    <div v-if="!store.status && !store.error" class="flex flex-1 items-center justify-center text-secondary"><span class="material-symbols-outlined mr-2 animate-spin">progress_activity</span>正在检查连接器…</div>

    <div v-else-if="!store.configured" class="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <section class="w-full max-w-2xl rounded-xl border border-outline-variant/30 bg-surface-bright p-6 shadow-sm md:p-8">
        <div class="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-tertiary-fixed text-tertiary"><span class="material-symbols-outlined text-3xl">key_off</span></div>
        <h3 class="font-headline text-2xl font-bold text-on-surface">尚未配置小米云凭证</h3>
        <p class="mt-3 leading-7 text-secondary">{{ store.status?.message || store.error }}</p>
        <code class="mt-5 block overflow-x-auto rounded-lg bg-inverse-surface p-3 text-xs text-inverse-on-surface">XIAOMI_CLOUD_COOKIE="本人 i.mi.com 会话的完整 Cookie"</code>
        <button class="mt-6 rounded-xl bg-primary px-5 py-2.5 font-bold text-on-primary" @click="refresh">重新检测</button>
      </section>
    </div>

    <div v-else class="flex min-h-0 flex-1 overflow-hidden">
      <aside v-show="!secondarySidebarHidden || isMobile" class="relative flex min-h-0 flex-shrink-0 flex-col border-r border-outline-variant/25 bg-surface-container-low/55" :class="{ 'hidden md:flex': isMobile && editorMode !== 'empty' }" :style="{ width: isMobile ? '100%' : `${secondarySidebarWidth}px` }">
        <div class="flex-shrink-0 p-4">
          <div class="mb-3 grid grid-cols-3 rounded-xl bg-surface-container-high p-1">
            <button class="rounded-lg px-2 py-1.5 text-[11px] font-bold" :class="noteScope === 'active' ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="noteScope = 'active'">使用中</button>
            <button class="rounded-lg px-2 py-1.5 text-[11px] font-bold" :class="noteScope === 'favorite' ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="noteScope = 'favorite'">收藏</button>
            <button class="rounded-lg px-2 py-1.5 text-[11px] font-bold" :class="noteScope === 'archived' ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="noteScope = 'archived'">已归档</button>
          </div>
          <label class="flex items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-bright px-4 py-2.5 focus-within:ring-2 focus-within:ring-primary/25">
            <span class="material-symbols-outlined text-[20px] text-secondary">search</span>
            <input v-model="searchQuery" class="w-full border-0 bg-transparent p-0 text-sm focus:ring-0" type="search" placeholder="搜索标题与摘要" />
          </label>
          <div class="mt-3 flex items-center gap-2">
            <span class="material-symbols-outlined text-[18px] text-secondary">folder</span>
            <select v-model="selectedFolder" class="min-w-0 flex-1 rounded-lg border-outline-variant/30 bg-surface-bright py-1.5 pl-3 pr-8 text-xs font-bold text-on-surface focus:border-primary focus:ring-primary/20">
              <option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">{{ folder.title }} ({{ folder.count }})</option>
            </select>
          </div>
          <div class="mt-3 flex items-center justify-between px-1 text-xs text-secondary"><span>{{ filteredNotes.length }} 条已加载</span><button v-if="!isMobile" class="font-bold hover:text-primary" @click="toggleSecondarySidebar">隐藏列表</button></div>
        </div>

        <div v-if="store.error" class="mx-4 mb-3 flex items-start gap-2 rounded-xl bg-error-container/60 p-3 text-xs text-on-error-container"><span class="material-symbols-outlined text-[18px]">error</span><span class="min-w-0 flex-1">{{ store.error }}</span></div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <div v-if="store.loading && !store.notes.length" class="space-y-3"><div v-for="index in 6" :key="index" class="h-24 animate-pulse rounded-xl bg-surface-container-high"></div></div>
          <div v-else-if="!filteredNotes.length" class="flex h-full min-h-56 flex-col items-center justify-center px-6 text-center text-secondary"><span class="material-symbols-outlined mb-3 text-4xl text-outline">description</span><p class="font-bold text-on-surface">{{ searchQuery ? '没有匹配的笔记' : '暂无笔记' }}</p></div>
          <template v-else>
            <button v-for="note in filteredNotes" :key="note.id" class="mb-2 w-full rounded-xl border p-4 text-left transition" :class="selectedId === note.id ? 'border-primary/40 bg-primary-container text-on-primary-container shadow-sm' : 'border-transparent bg-surface-bright hover:border-outline-variant/40 hover:bg-surface-container-high'" @click="selectNote(note)">
              <div class="flex items-start justify-between gap-2">
                <h3 class="line-clamp-1 min-w-0 flex-1 text-sm font-bold">{{ note.title }}</h3>
                <span v-if="store.metadata[note.id]?.favorite" class="material-symbols-outlined filled text-[16px] text-tertiary">star</span>
                <time class="flex-shrink-0 text-[10px] opacity-70">{{ formatDate(note.modifyDate) }}</time>
              </div>
              <p class="mt-2 line-clamp-2 text-xs leading-5 opacity-75">{{ note.preview || '空白笔记' }}</p>
              <div v-if="store.metadata[note.id]?.tags.length" class="mt-2 flex flex-wrap gap-1"><span v-for="tag in store.metadata[note.id].tags.slice(0, 3)" :key="tag" class="rounded-full bg-secondary-container px-2 py-0.5 text-[9px] font-bold text-on-secondary-container">#{{ tag }}</span></div>
            </button>
          </template>
          <button v-if="!store.lastPage && !searchQuery" class="mt-2 w-full rounded-xl border border-outline-variant/40 bg-surface-bright py-2.5 text-sm font-bold text-primary disabled:opacity-50" :disabled="store.loadingMore" @click="store.loadNotes(false)">{{ store.loadingMore ? '正在加载…' : '加载更多' }}</button>
        </div>
      </aside>

      <div v-if="!isMobile && !secondarySidebarHidden" class="group relative w-1.5 flex-shrink-0 cursor-col-resize touch-none bg-outline-variant/10 hover:bg-primary/25" role="separator" aria-label="拖动调整二级侧边栏宽度" @pointerdown="startSecondaryResize"><div class="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-outline-variant group-hover:bg-primary"></div></div>

      <section class="min-w-0 flex-1 bg-background" :class="{ 'hidden md:block': isMobile && editorMode === 'empty' }">
        <div v-if="editorMode === 'empty'" class="flex h-full flex-col items-center justify-center p-8 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-xl bg-primary-container/20 text-primary"><span class="material-symbols-outlined text-4xl">edit_note</span></div>
          <h3 class="mt-5 font-headline text-2xl font-bold text-on-surface">选择或创建一条笔记</h3>
          <p class="mt-2 max-w-md text-sm leading-6 text-secondary">二级侧边栏可以拖动或隐藏；标题导航和文档标签也可按需关闭。</p>
          <button v-if="secondarySidebarHidden" class="mt-5 rounded-xl border border-outline-variant/40 px-4 py-2 text-sm font-bold text-primary" @click="toggleSecondarySidebar">显示笔记列表</button>
        </div>

        <div v-else class="flex h-full min-h-0 flex-col">
          <div class="flex flex-shrink-0 items-center justify-between gap-3 border-b border-outline-variant/25 px-3 py-2.5 md:px-5">
            <div class="flex min-w-0 items-center gap-1">
              <button class="toolbar-button md:hidden" aria-label="返回笔记列表" @click="closeEditor"><span class="material-symbols-outlined">arrow_back</span></button>
              <button v-if="secondarySidebarHidden && !isMobile" class="toolbar-button" aria-label="显示二级侧边栏" @click="toggleSecondarySidebar"><span class="material-symbols-outlined">right_panel_open</span></button>
              <button class="toolbar-button" title="插入一级标题" @click="insertHeading(1)"><span class="text-sm font-black">H1</span></button>
              <button class="toolbar-button" title="插入二级标题" @click="insertHeading(2)"><span class="text-sm font-black">H2</span></button>
              <span class="mx-1 h-5 w-px bg-outline-variant/40"></span>
              <button class="toolbar-button" :class="outlineVisible ? 'text-primary' : ''" title="显示或隐藏一级/二级标题导航" @click="toggleOutline"><span class="material-symbols-outlined text-[20px]">toc</span></button>
              <button class="toolbar-button" :class="tabsVisible ? 'text-primary' : ''" title="显示或隐藏文档标签" @click="toggleTabs"><span class="material-symbols-outlined text-[20px]">tab</span></button>
            </div>
            <div class="flex items-center gap-1.5">
              <button v-if="editorMode === 'edit'" class="toolbar-button" :class="selectedMetadata?.favorite ? 'text-tertiary' : ''" title="切换收藏" @click="toggleFavorite"><span class="material-symbols-outlined text-[20px]" :class="{ filled: selectedMetadata?.favorite }">star</span></button>
              <button v-if="editorMode === 'edit'" class="toolbar-button" :class="selectedMetadata?.archived ? 'text-tertiary' : ''" title="切换归档" @click="toggleArchived"><span class="material-symbols-outlined text-[20px]">archive</span></button>
              <button v-if="editorMode === 'edit'" class="toolbar-button" title="版本历史" @click="openHistory"><span class="material-symbols-outlined text-[20px]">history</span></button>
              <button v-if="editorMode === 'edit'" class="toolbar-button text-error" title="删除笔记" :disabled="store.saving || !store.writable" @click="deleteNote"><span class="material-symbols-outlined text-[20px]">delete</span></button>
              <button class="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary shadow-sm disabled:cursor-not-allowed disabled:opacity-40" :disabled="!canSave || store.loadingDetail || !store.writable" @click="saveNote">{{ store.saving ? '同步中…' : '保存' }}</button>
            </div>
          </div>

          <div v-if="tabsVisible && openTabs.length" class="no-scrollbar flex flex-shrink-0 items-end gap-1 overflow-x-auto border-b border-outline-variant/25 bg-surface-container-low/40 px-3 pt-2">
            <button v-for="tab in openTabs" :key="tab.id" class="group flex max-w-52 items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 text-xs font-bold" :class="selectedId === tab.id ? 'border-outline-variant/40 bg-background text-primary' : 'border-transparent text-secondary hover:bg-surface-container-high'" @click="openNote(tab.id, tab.title)"><span class="truncate">{{ tab.title }}</span><span class="material-symbols-outlined hidden text-[15px] opacity-60 hover:text-error group-hover:inline" @click="closeTab(tab.id, $event)">close</span></button>
          </div>

          <div v-if="outlineVisible" class="flex flex-shrink-0 items-center gap-2 border-b border-outline-variant/20 bg-surface-container-low/35 px-3 py-2 md:px-5">
            <div class="flex rounded-lg bg-surface-container-high p-0.5"><button class="rounded-md px-2.5 py-1 text-[11px] font-bold" :class="outlineLevel === 1 ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="outlineLevel = 1">一级标题</button><button class="rounded-md px-2.5 py-1 text-[11px] font-bold" :class="outlineLevel === 2 ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="outlineLevel = 2">二级标题</button></div>
            <div class="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto"><button v-for="item in visibleOutlineItems" :key="`${item.line}-${item.title}`" class="max-w-56 flex-shrink-0 truncate rounded-lg border border-outline-variant/30 bg-surface-bright px-3 py-1.5 text-left text-[11px] font-bold text-secondary hover:border-primary/30 hover:text-primary" @click="jumpToHeading(item)">{{ item.title }}</button><span v-if="!visibleOutlineItems.length" class="px-2 text-[11px] text-secondary">正文中暂无 {{ outlineLevel === 1 ? '# 一级标题' : '## 二级标题' }}</span></div>
            <button class="toolbar-button h-7 w-7" aria-label="隐藏标题导航" @click="toggleOutline"><span class="material-symbols-outlined text-[17px]">close</span></button>
          </div>

          <div v-if="store.loadingDetail" class="flex flex-1 items-center justify-center text-secondary"><span class="material-symbols-outlined mr-2 animate-spin">progress_activity</span>正在加载正文…</div>
          <div v-else class="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 md:p-8">
            <input v-model="draft.title" maxlength="200" class="w-full border-0 bg-transparent p-0 font-headline text-2xl font-bold text-on-surface placeholder:text-outline/70 focus:ring-0 md:text-3xl" placeholder="笔记标题" />
            <div class="mt-3 flex items-center justify-between border-b border-outline-variant/25 pb-3 text-[10px] text-secondary"><span>{{ draft.title.length }}/200</span><span v-if="isDirty" class="font-bold text-tertiary">未保存</span><span v-else>已同步</span></div>
            <div v-if="editorMode === 'edit' && selectedMetadata" class="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-container-low p-3">
              <button class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold" :class="selectedMetadata.favorite ? 'bg-tertiary-fixed text-tertiary' : 'bg-surface-bright text-secondary'" @click="toggleFavorite"><span class="material-symbols-outlined text-[17px]" :class="{ filled: selectedMetadata.favorite }">star</span>{{ selectedMetadata.favorite ? '已收藏' : '收藏' }}</button>
              <button class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold" :class="selectedMetadata.archived ? 'bg-tertiary-fixed text-tertiary' : 'bg-surface-bright text-secondary'" @click="toggleArchived"><span class="material-symbols-outlined text-[17px]">archive</span>{{ selectedMetadata.archived ? '已归档' : '归档' }}</button>
              <select :value="selectedMetadata.privacy" class="rounded-lg border-outline-variant/30 bg-surface-bright py-1 pl-2 pr-7 text-xs font-bold focus:border-primary focus:ring-primary/20" @change="updatePrivacy"><option value="private">私人</option><option value="secret">机密</option><option value="public">公开级</option></select>
              <div class="flex min-w-44 flex-1 items-center gap-1"><input v-model="tagInput" maxlength="32" class="min-w-0 flex-1 rounded-lg border-outline-variant/30 bg-surface-bright py-1 text-xs focus:border-primary focus:ring-primary/20" placeholder="添加标签" @keydown.enter.prevent="addTag" /><button class="rounded-lg bg-primary px-2 py-1 text-xs font-bold text-on-primary disabled:opacity-40" :disabled="!tagInput.trim() || store.savingMetadata" @click="addTag">添加</button></div>
              <div class="flex flex-wrap gap-1"><button v-for="tag in selectedMetadata.tags" :key="tag" class="group rounded-full bg-secondary-container px-2 py-1 text-[10px] font-bold text-on-secondary-container" @click="removeTag(tag)">#{{ tag }} <span class="opacity-50 group-hover:text-error">?</span></button></div>
            </div>
            <textarea ref="contentEditor" v-model="draft.content" maxlength="80000" class="mt-5 min-h-[55vh] w-full flex-1 resize-none border-0 bg-transparent p-0 text-[15px] leading-7 text-on-surface placeholder:text-outline/70 focus:ring-0" placeholder="开始记录… 使用 # 一级标题、## 二级标题建立大纲"></textarea>
            <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] text-secondary"><span>{{ draft.content.length.toLocaleString() }}/80,000 字符</span><span v-if="editorMode === 'edit' && store.selectedNote?.hasRichFormatting" class="font-bold text-tertiary">检测到富文本：仅修改标题时会保留原格式；修改正文或恢复历史会转为纯文本</span><span v-else-if="editorMode === 'edit'">每次覆盖保存前会自动创建 Terra 本地历史</span></div>
            <div v-if="store.error" class="mt-4 flex items-start gap-2 rounded-xl bg-error-container/60 p-3 text-sm text-on-error-container"><span class="material-symbols-outlined text-[20px]">error</span>{{ store.error }}</div>
          </div>
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div v-if="historyOpen" class="fixed inset-0 z-[90] flex justify-end bg-black/20 backdrop-blur-[2px]" @click.self="historyOpen = false">
        <aside class="flex h-full w-full max-w-xl flex-col border-l border-outline-variant/30 bg-background shadow-2xl">
          <header class="flex items-start justify-between gap-3 border-b border-outline-variant/25 px-4 py-4 sm:px-5">
            <div class="min-w-0">
              <h3 class="font-headline text-xl font-bold text-on-surface">{{ historyMode === 'archive' ? '历史归档' : '版本历史' }}</h3>
              <p class="mt-1 text-xs text-secondary">Terra 本地加密快照，不等同于小米官方历史</p>
            </div>
            <button class="toolbar-button" aria-label="关闭历史" @click="historyOpen = false"><span class="material-symbols-outlined">close</span></button>
          </header>
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 px-4 py-3 sm:px-5">
            <span class="min-w-0 text-xs text-secondary">{{ historyMode === 'archive' ? `${store.historyArchive.length} 个笔记历史组` : '每篇最多保留 60 个版本' }}</span>
            <div class="flex flex-wrap items-center justify-end gap-2"><button v-if="historyTargetId && store.history.length" class="whitespace-nowrap rounded-lg border border-error/35 px-3 py-1.5 text-xs font-bold text-error disabled:opacity-40" :disabled="store.deletingHistory" @click="clearHistoryGroup">清理本篇历史</button><button v-if="historyMode === 'current'" class="whitespace-nowrap rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs font-bold text-primary disabled:opacity-40" :disabled="isDirty || store.loadingHistory" @click="createCheckpoint">创建快照</button></div>
          </div>
          <div v-if="store.historyError" class="m-4 rounded-xl bg-error-container/60 p-3 text-sm text-on-error-container">{{ store.historyError }}</div>
          <div v-if="(store.loadingHistory && !store.history.length) || (store.loadingArchive && !store.historyArchive.length)" class="flex flex-1 items-center justify-center text-secondary"><span class="material-symbols-outlined mr-2 animate-spin">progress_activity</span>正在加载历史…</div>
          <div v-else class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] md:grid-rows-[minmax(190px,42%)_1fr]">
            <div class="overflow-y-auto p-3 md:border-b md:border-outline-variant/25" :class="{ 'hidden md:block': historyDetailVisible }">
              <template v-if="historyMode === 'archive' && !archiveSelectedNoteId">
                <button v-for="group in store.historyArchive" :key="group.noteId" class="mb-2 w-full rounded-xl border border-transparent bg-surface-container-low p-3 text-left hover:border-outline-variant/40" @click="selectArchiveGroup(group.noteId)">
                  <div class="flex items-center justify-between gap-2"><span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="group.deletedCandidate ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'">{{ group.deletedCandidate ? '删除前快照' : '历史分组' }}</span><time class="text-[10px] text-secondary">{{ formatFullDate(group.lastCapturedAt) }}</time></div>
                  <p class="mt-2 line-clamp-1 text-sm font-bold text-on-surface">{{ group.title }}</p><p class="mt-1 line-clamp-2 text-xs text-secondary">{{ group.preview || '空白版本' }}</p><p class="mt-2 text-[10px] font-bold text-primary">{{ group.versionCount }} 个版本</p>
                </button>
                <div v-if="!store.historyArchive.length" class="flex h-full min-h-40 flex-col items-center justify-center text-center text-secondary"><span class="material-symbols-outlined mb-2 text-3xl">inventory_2</span><p class="text-sm font-bold">暂无历史归档</p></div>
              </template>
              <template v-else>
                <button v-if="historyMode === 'archive'" class="mb-3 flex items-center gap-1 text-xs font-bold text-primary" @click="backToArchiveGroups"><span class="material-symbols-outlined text-[18px]">arrow_back</span>返回归档</button>
                <button v-for="entry in store.history" :key="entry.id" class="mb-2 w-full rounded-xl border p-3 text-left" :class="store.selectedHistory?.id === entry.id ? 'border-primary/40 bg-primary-container text-on-primary-container' : 'border-transparent bg-surface-container-low hover:border-outline-variant/40'" @click="openHistoryVersion(entry.noteId, entry.id)">
                  <div class="flex items-center justify-between gap-2"><span class="text-xs font-bold">{{ historyReasonLabel(entry.reason) }}</span><time class="text-[10px] opacity-70">{{ formatFullDate(entry.capturedAt) }}</time></div><p class="mt-1 line-clamp-1 text-sm font-bold">{{ entry.title }}</p><p class="mt-1 line-clamp-2 text-xs opacity-70">{{ entry.preview || '空白版本' }}</p>
                </button>
                <div v-if="!store.history.length" class="flex h-full min-h-40 flex-col items-center justify-center text-center text-secondary"><span class="material-symbols-outlined mb-2 text-3xl">history_toggle_off</span><p class="text-sm font-bold">暂无历史版本</p></div>
              </template>
            </div>
            <div class="min-h-0 flex-col p-4 sm:p-5" :class="historyDetailVisible ? 'flex' : 'hidden md:flex'">
              <template v-if="store.selectedHistory">
                <div class="flex flex-wrap items-start gap-3"><button class="toolbar-button md:hidden" aria-label="返回历史版本列表" @click="historyDetailVisible = false"><span class="material-symbols-outlined">arrow_back</span></button><div class="min-w-0 flex-1"><h4 class="truncate font-headline text-lg font-bold">{{ store.selectedHistory.title }}</h4><p class="mt-1 text-xs text-secondary">{{ formatFullDate(store.selectedHistory.capturedAt) }} · {{ historyReasonLabel(store.selectedHistory.reason) }}</p></div><div class="ml-auto flex flex-shrink-0 items-center gap-2"><button class="toolbar-button text-error" title="删除这个 Terra 历史版本" :disabled="store.deletingHistory" @click="deleteSelectedHistory"><span class="material-symbols-outlined text-[19px]">delete</span></button><button class="whitespace-nowrap rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-40" :disabled="store.restoring || !store.writable" @click="historyMode === 'archive' ? recreateHistoryVersion() : restoreHistory()">{{ store.restoring ? '处理中…' : (historyMode === 'archive' ? '重建笔记' : '恢复版本') }}</button></div></div>
                <pre class="mt-4 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-container-low p-4 font-body text-sm leading-6 text-on-surface">{{ store.selectedHistory.content || '空白版本' }}</pre>
              </template>
              <div v-else class="flex flex-1 items-center justify-center text-sm text-secondary">选择一个历史版本查看正文</div>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>

    <transition name="toast"><div v-if="toast" class="fixed left-1/2 top-6 z-[100] -translate-x-1/2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-xl">{{ toast }}</div></transition>
  </div>
</template>

<style scoped>
.toolbar-button { @apply flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-secondary transition hover:bg-surface-container-high hover:text-primary disabled:cursor-not-allowed disabled:opacity-40; }
.toast-enter-active, .toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -8px); }
:global(body.notes-resize-active) { cursor: col-resize; user-select: none; }
</style>
