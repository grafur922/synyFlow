<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  PanelLeftOpen,
  PanelLeftClose,
  NotebookTabs,
  Star,
  History,
  MoreVertical,
  ArchiveRestore,
  Archive,
  Trash2,
  Loader2,
  Save,
  Check,
  RefreshCw,
  Plus,
  Lock,
  KeyRound,
  CloudOff,
  ShieldCheck,
  Shield,
  EyeOff,
  Eye,
  AlertCircle,
  Search,
  Folder,
  FileText,
  FilePenLine,
  X
} from 'lucide-vue-next'
import { useIsMobile } from '../composables/useIsMobile'
import { usePrimarySidebar } from '../composables/usePrimarySidebar'
import { useXiaomiNotesStore } from '../store/xiaomiNotes'
import type { NotePrivacyLevel, XiaomiNote, XiaomiNoteHistoryReason } from '../shared/xiaomiNote'

type EditorMode = 'empty' | 'new' | 'edit'

const route = useRoute()
const router = useRouter()
const store = useXiaomiNotesStore()
const isMobile = useIsMobile()
const { autoCollapseOnEdit, setCollapsed: setPrimarySidebarCollapsed } = usePrimarySidebar()

const searchQuery = ref('')
const selectedFolder = ref('all')
const noteScope = ref<'active' | 'favorite' | 'archived'>('active')
const editorMode = ref<EditorMode>('empty')
const draft = reactive({ title: '', content: '' })
const savedSnapshot = ref(JSON.stringify(draft))
const toast = ref('')
const contentEditor = ref<HTMLTextAreaElement>()
const workspaceRoot = ref<HTMLElement>()
const secondarySidebarWidth = ref(360)
const secondarySidebarHidden = ref(false)

// 更多菜单与标签输入控制
const moreMenuOpen = ref(false)
const tagInputVisible = ref(false)
const tagInput = ref('')
const tagInputRef = ref<HTMLInputElement>()

// 历史版本抽屉控制
const historyOpen = ref(false)
const historyMode = ref<'current' | 'archive'>('current')
const archiveSelectedNoteId = ref('')
const historyDetailVisible = ref(false)

// 凭证配置
const credentialCookie = ref('')
const credentialVisible = ref(false)
const credentialError = ref('')

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
    const searchable = `${note.title}\n${note.preview}\n${metadata?.tags?.join(' ') || ''}`
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

const currentFolderTitle = computed(() => {
  if (selectedFolder.value === 'all') return '全部笔记'
  if (selectedFolder.value === '0') return '未分类'
  return store.folders.find((f) => f.id === selectedFolder.value)?.title || '笔记'
})

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
const showCredentialSetup = computed(() => Boolean(
  store.status?.credentialWritable && (!store.configured || store.status.mode === 'credentials_invalid')
))
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

  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('keydown', handleShortcut)
  window.addEventListener('resize', handleViewportResize)
  window.addEventListener('pointerdown', handleGlobalPointerDown)
  handleViewportResize()

  // 若本地缓存已有选中的笔记，直接直出展示，实现 0ms 秒开
  if (store.selectedNote && !route.query.new && !route.query.note) {
    editorMode.value = 'edit'
    resetDraft(store.selectedNote)
  }

  void store.initialize()
})

onBeforeUnmount(() => {
  credentialCookie.value = ''
  credentialError.value = ''
  stopSecondaryDrag?.()
  window.cancelAnimationFrame(resizeFrame)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleShortcut)
  window.removeEventListener('resize', handleViewportResize)
  window.removeEventListener('pointerdown', handleGlobalPointerDown)
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
    await openNote(value)
    const query = { ...route.query }
    delete query.note
    void router.replace({ path: '/xiaomi-notes', query })
  },
  { immediate: true }
)

function handleGlobalPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.more-menu-container')) {
    moreMenuOpen.value = false
  }
}

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
  moreMenuOpen.value = false
  editorMode.value = 'new'
  resetDraft()
  if (isMobile.value) {
    secondarySidebarHidden.value = true
  } else if (autoCollapseOnEdit.value) {
    setPrimarySidebarCollapsed(true)
  }
  void nextTick(() => contentEditor.value?.focus())
}

async function selectNote(note: XiaomiNote) {
  return openNote(note.id, note.title, note.content || note.preview || '')
}

async function openNote(id: string, fallbackTitle = '', fallbackContent = '') {
  if (selectedId.value === id && editorMode.value === 'edit') return
  if (!allowDiscard()) return
  const requestId = ++openRequestId
  editorMode.value = 'edit'
  historyOpen.value = false
  moreMenuOpen.value = false

  const localSummary = store.notes.find((n) => n.id === id)
  const initialTitle = fallbackTitle || localSummary?.title || ''
  const initialContent = fallbackContent || (store.selectedNote?.id === id ? store.selectedNote.content : '') || localSummary?.preview || ''

  resetDraft({
    id,
    title: initialTitle,
    content: initialContent,
    tag: id,
    preview: localSummary?.preview || '',
    createDate: localSummary?.createDate || 0,
    modifyDate: localSummary?.modifyDate || 0,
    colorId: 0,
    folderId: localSummary?.folderId || '0',
    status: 'normal',
    hasRichFormatting: false
  })

  const detail = await store.selectNote(id)
  if (requestId !== openRequestId) return
  if (detail) {
    resetDraft(detail)
    if (isMobile.value) {
      secondarySidebarHidden.value = true
    } else if (autoCollapseOnEdit.value) {
      setPrimarySidebarCollapsed(true)
    }
  } else if (!initialTitle && !initialContent) {
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
  moreMenuOpen.value = false
  resetDraft()
  if (isMobile.value) secondarySidebarHidden.value = false
}

async function saveNote() {
  if (!store.writable) {
    showToast(store.status?.message || '小米笔记连接器当前不可写')
    return
  }
  if (!canSave.value) return
  if (editorMode.value === 'edit' && !isDirty.value) {
    showToast('当前笔记已是最新版本')
    return
  }
  const payload = { title: draft.title.trim(), content: draft.content }
  const note = editorMode.value === 'new'
    ? await store.createNote(payload)
    : store.selectedNote
      ? await store.updateNote(store.selectedNote.id, payload)
      : undefined

  if (!note) return
  editorMode.value = 'edit'
  resetDraft(note)
  showToast('已同步到小米笔记')
}

async function deleteNote() {
  const note = store.selectedNote
  if (!note || store.saving || !store.writable) return
  moreMenuOpen.value = false
  if (!window.confirm(`确定将“${note.title}”移到小米笔记回收站吗？删除前会自动保留本地历史快照。`)) return
  const deleted = await store.deleteNote(note.id)
  if (deleted) {
    editorMode.value = 'empty'
    resetDraft()
    showToast('笔记已移到回收站')
    if (isMobile.value) secondarySidebarHidden.value = false
  }
}

async function saveCredentialCookie() {
  credentialError.value = ''
  const cookie = credentialCookie.value.trim()
  if (!cookie) {
    credentialError.value = '请输入完整 Cookie'
    return
  }
  if (cookie.length > 24_000) {
    credentialError.value = 'Cookie 超过长度限制'
    return
  }
  if (!/(?:^|;\s*)serviceToken=[^;\s]+/.test(cookie)) {
    credentialError.value = '完整 Cookie 中未找到 serviceToken'
    return
  }
  const saved = await store.saveCredentials(cookie)
  if (!saved) {
    credentialError.value = store.error || '凭证保存失败'
    return
  }
  credentialCookie.value = ''
  credentialVisible.value = false
  credentialError.value = ''
  showToast('Cookie 已使用 Windows DPAPI 安全保存')
}

async function refresh() {
  await store.refreshStatus()
  if (store.status?.configured) {
    await store.loadNotes(true, true)
    showToast(store.error ? '刷新失败' : '列表已刷新')
  }
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

async function openHistory() {
  if (!store.selectedNote) return
  moreMenuOpen.value = false
  historyMode.value = 'current'
  archiveSelectedNoteId.value = ''
  historyDetailVisible.value = false
  historyOpen.value = true
  await store.loadHistory(store.selectedNote.id)
}

async function openHistoryArchive() {
  moreMenuOpen.value = false
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
    showToast('历史版本已恢复并同步到小米笔记')
  }
}

async function recreateHistoryVersion() {
  if (!store.selectedHistory || !store.writable) return
  if (!window.confirm('确定从这个历史版本重建一条新的小米笔记吗？')) return
  const recreated = await store.recreateFromHistory(store.selectedHistory.id)
  if (recreated) {
    editorMode.value = 'edit'
    resetDraft(recreated)
    historyOpen.value = false
    showToast('已从历史版本重建为新的小米笔记')
  }
}

async function deleteSelectedHistory() {
  const entry = store.selectedHistory
  if (!entry || store.deletingHistory) return
  if (!window.confirm(`确定删除 ${formatFullDate(entry.capturedAt)} 的本地历史版本吗？此操作不会修改小米云笔记。`)) return
  const deleted = await store.deleteHistoryVersion(entry.noteId, entry.id)
  if (!deleted) return
  if (isMobile.value) historyDetailVisible.value = false
  if (historyMode.value === 'archive' && store.history.length === 0) backToArchiveGroups()
  showToast('本地历史版本已删除')
}

async function clearHistoryGroup() {
  const noteId = historyTargetId.value
  if (!noteId || !store.history.length || store.deletingHistory) return
  if (!window.confirm(`确定清理这篇笔记的 ${store.history.length} 个本地历史版本吗？此操作不可撤销，也不会修改小米云笔记。`)) return
  const removed = await store.clearNoteHistory(noteId)
  if (removed === undefined) return
  if (historyMode.value === 'archive') backToArchiveGroups()
  showToast(`已清理 ${removed} 个本地历史版本`)
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
  moreMenuOpen.value = false
  showToast(archived ? '已归档' : '已恢复到使用中列表')
}

function showTagInput() {
  tagInputVisible.value = true
  void nextTick(() => tagInputRef.value?.focus())
}

async function addTag() {
  if (!selectedId.value || !selectedMetadata.value) return
  const tag = tagInput.value.trim().replace(/\s+/g, ' ')
  if (!tag) {
    tagInputVisible.value = false
    return
  }
  const tags = Array.from(new Set([...selectedMetadata.value.tags, tag]))
  const updated = await store.updateMetadata(selectedId.value, { tags })
  if (updated) {
    tagInput.value = ''
    tagInputVisible.value = false
  }
}

async function removeTag(tag: string) {
  if (!selectedId.value || !selectedMetadata.value) return
  await store.updateMetadata(selectedId.value, { tags: selectedMetadata.value.tags.filter((item) => item !== tag) })
}

async function updatePrivacy(privacy: NotePrivacyLevel) {
  if (!selectedId.value) return
  await store.updateMetadata(selectedId.value, { privacy })
  moreMenuOpen.value = false
  showToast(`隐私等级已设置为：${privacyLabel(privacy)}`)
}

function privacyLabel(privacy: NotePrivacyLevel) {
  return ({ private: '私人', public: '公开' } as Record<NotePrivacyLevel, string>)[privacy] || privacy
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
  <div ref="workspaceRoot" class="relative flex h-full min-h-0 flex-col bg-background text-on-background">
    <!-- 统一通透顶栏：合并所有操作与状态 -->
    <header class="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-outline-variant/20 bg-background/90 px-4 backdrop-blur-xl md:px-6">
      <div class="flex min-w-0 items-center gap-2 sm:gap-3">
        <!-- 移动端返回列表按钮 -->
        <button
          v-if="isMobile && editorMode !== 'empty'"
          class="toolbar-button"
          aria-label="返回笔记列表"
          @click="closeEditor"
        >
          <ArrowLeft class="h-4 w-4" :stroke-width="2" />
        </button>

        <!-- 桌面端切换侧边栏展开/折叠 -->
        <button
          v-if="!isMobile"
          class="toolbar-button"
          :aria-label="secondarySidebarHidden ? '展开笔记列表' : '折叠笔记列表'"
          @click="toggleSecondarySidebar"
        >
          <component :is="secondarySidebarHidden ? PanelLeftOpen : PanelLeftClose" class="h-4 w-4" :stroke-width="1.85" />
        </button>

        <div class="flex min-w-0 items-center gap-2">
          <NotebookTabs class="h-4.5 w-4.5 text-primary flex-shrink-0" :stroke-width="2" />
          <h2 class="truncate font-headline text-base font-bold text-on-surface sm:text-lg">
            小米笔记
          </h2>
          <span class="text-outline-variant/60">/</span>
          <span class="truncate text-xs font-semibold text-secondary">
            {{ currentFolderTitle }}
          </span>
          <span v-if="store.status?.historyStorage?.encryptedAtRest" class="hidden rounded-full bg-primary-container/40 px-2 py-0.5 text-[10px] font-bold text-primary lg:inline-block">
            加密存储
          </span>
        </div>
      </div>

      <!-- 右侧操作区 -->
      <div class="flex items-center gap-1.5">
        <template v-if="editorMode !== 'empty'">
          <!-- 收藏/星标 -->
          <button
            v-if="editorMode === 'edit'"
            class="toolbar-button transition-transform active:scale-90"
            :class="selectedMetadata?.favorite ? 'text-amber-500 hover:text-amber-600' : 'text-secondary'"
            :title="selectedMetadata?.favorite ? '取消收藏' : '加入收藏'"
            @click="toggleFavorite"
          >
            <Star class="h-4 w-4 transition-colors" :class="selectedMetadata?.favorite ? 'fill-amber-500 text-amber-500' : 'text-secondary'" :stroke-width="1.85" />
          </button>

          <!-- 版本历史 -->
          <button
            v-if="editorMode === 'edit'"
            class="toolbar-button"
            title="查看本地历史快照"
            @click="openHistory"
          >
            <History class="h-4 w-4" :stroke-width="2" />
          </button>

          <!-- 更多操作下拉菜单 -->
          <div v-if="editorMode === 'edit'" class="more-menu-container relative">
            <button
              class="toolbar-button"
              :class="{ 'bg-surface-container-high text-primary': moreMenuOpen }"
              aria-label="更多操作"
              @click="moreMenuOpen = !moreMenuOpen"
            >
              <MoreVertical class="h-4 w-4" :stroke-width="2" />
            </button>

            <!-- 浮动菜单 Popover -->
            <transition name="menu">
              <div
                v-if="moreMenuOpen"
                class="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-bright p-1.5 shadow-2xl backdrop-blur-2xl"
              >
                <!-- 归档切换 -->
                <button
                  class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-on-surface transition hover:bg-surface-container-high"
                  @click="toggleArchived"
                >
                  <component :is="selectedMetadata?.archived ? ArchiveRestore : Archive" class="h-3.5 w-3.5 text-secondary flex-shrink-0" :stroke-width="2" />
                  <span>{{ selectedMetadata?.archived ? '从归档中移出' : '归档这篇笔记' }}</span>
                </button>

                <!-- 隐私等级切换 -->
                <div class="my-1 border-t border-outline-variant/20 pt-1">
                  <p class="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-secondary/70">隐私访问等级</p>
                  <div class="grid grid-cols-2 gap-1 px-1">
                    <button
                      v-for="p in (['private', 'public'] as NotePrivacyLevel[])"
                      :key="p"
                      class="rounded-lg py-1 text-[11px] font-bold transition"
                      :class="selectedMetadata?.privacy === p ? 'bg-primary-container text-on-primary-container' : 'text-secondary hover:bg-surface-container-high'"
                      @click="updatePrivacy(p)"
                    >
                      {{ privacyLabel(p) }}
                    </button>
                  </div>
                </div>

                <!-- 分割线与删除 -->
                <div class="mt-1 border-t border-outline-variant/20 pt-1">
                  <button
                    class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-error transition hover:bg-error-container/40"
                    :disabled="store.saving || !store.writable"
                    @click="deleteNote"
                  >
                    <Trash2 class="h-3.5 w-3.5 text-error flex-shrink-0" :stroke-width="1.85" />
                    <span>移至回收站</span>
                  </button>
                </div>
              </div>
            </transition>
          </div>

          <!-- 保存按钮 -->
          <button
            class="flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold transition disabled:cursor-not-allowed"
            :class="(isDirty || editorMode === 'new') ? 'bg-primary text-on-primary shadow-sm hover:brightness-105 active:scale-95' : 'border border-outline-variant/30 bg-surface-container-high text-secondary/80 opacity-75'"
            :disabled="!canSave || (!isDirty && editorMode === 'edit') || store.loadingDetail || !store.writable || store.saving"
            @click="saveNote"
          >
            <Loader2 v-if="store.saving" class="h-3.5 w-3.5 animate-spin" :stroke-width="2.5" />
            <Save v-else-if="isDirty || editorMode === 'new'" class="h-3.5 w-3.5" :stroke-width="2" />
            <Check v-else class="h-3.5 w-3.5" :stroke-width="2.5" />
            <span>{{ store.saving ? '同步中…' : ((isDirty || editorMode === 'new') ? '保存' : '已同步') }}</span>
          </button>
        </template>

        <template v-else>
          <!-- 历史归档库入口 -->
          <button
            class="toolbar-button"
            title="打开本地历史归档库"
            @click="openHistoryArchive"
          >
            <Archive class="h-4 w-4" :stroke-width="2" />
          </button>

          <!-- 刷新笔记列表 -->
          <button
            class="toolbar-button"
            :disabled="store.loading"
            title="刷新笔记"
            @click="refresh"
          >
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': store.loading }" :stroke-width="2" />
          </button>
        </template>

        <!-- 新建笔记按钮 -->
        <button
          class="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-on-primary shadow-sm transition hover:brightness-105 active:scale-95 disabled:opacity-40"
          :disabled="!store.writable"
          @click="startNew"
        >
          <Plus class="h-3.5 w-3.5" :stroke-width="2.2" />
          <span class="hidden sm:inline">新建</span>
        </button>
      </div>
    </header>

    <!-- 连接器状态告警 -->
    <div v-if="store.status?.mode === 'readonly' || store.status?.mode === 'credentials_invalid' || store.status?.mode === 'circuit_open'" class="flex flex-shrink-0 items-start gap-2 border-b border-outline-variant/20 px-5 py-2 text-xs md:px-6" :class="store.status.mode === 'readonly' ? 'bg-tertiary-fixed/45 text-on-tertiary-fixed-variant' : 'bg-error-container/55 text-on-error-container'">
      <component :is="store.status.mode === 'readonly' ? Lock : store.status.mode === 'credentials_invalid' ? KeyRound : CloudOff" class="h-4 w-4 flex-shrink-0" :stroke-width="2" />
      <span>{{ store.status.message }}<span v-if="store.status.retryAfterSeconds">（约 {{ store.status.retryAfterSeconds }} 秒后可重试）</span></span>
    </div>

    <!-- 加载检查连接器 -->
    <div v-if="!store.status && !store.error" class="flex flex-1 items-center justify-center text-secondary">
      <Loader2 class="mr-2 h-4 w-4 animate-spin" :stroke-width="2.5" />正在检查连接器…
    </div>

    <!-- 凭证引导界面 -->
    <div v-else-if="showCredentialSetup" class="flex flex-1 items-center justify-center overflow-y-auto p-5 md:p-8">
      <section class="w-full max-w-2xl overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-bright shadow-sm">
        <div class="border-b border-outline-variant/20 bg-gradient-to-br from-primary-container/70 via-surface-bright to-tertiary-fixed/35 p-6 md:p-8">
          <div class="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-sm">
            <ShieldCheck class="h-7 w-7 text-on-primary" :stroke-width="2" />
          </div>
          <p class="text-xs font-black uppercase tracking-[0.18em] text-primary">Windows 安全凭证</p>
          <h3 class="mt-2 font-headline text-2xl font-bold text-on-surface">{{ store.status?.mode === 'credentials_invalid' ? '更新小米云 Cookie' : '连接你的小米笔记' }}</h3>
          <p class="mt-3 max-w-xl leading-7 text-secondary">粘贴本人 <strong class="text-on-surface">i.mi.com</strong> 会话的完整 Cookie。synyFlow 只会将其发送到本机后端，并使用当前 Windows用户的 DPAPI 加密保存。</p>
        </div>

        <form class="space-y-5 p-6 md:p-8" @submit.prevent="saveCredentialCookie">
          <div>
            <div class="mb-2 flex items-center justify-between gap-3">
              <label for="xiaomi-cookie" class="text-sm font-bold text-on-surface">完整 Cookie</label>
              <button type="button" class="flex items-center gap-1 text-xs font-bold text-primary hover:opacity-75" @click="credentialVisible = !credentialVisible">
                <component :is="credentialVisible ? EyeOff : Eye" class="h-4 w-4" :stroke-width="2" />
                {{ credentialVisible ? '隐藏内容' : '显示内容' }}
              </button>
            </div>
            <textarea id="xiaomi-cookie" v-model="credentialCookie" rows="5" maxlength="24000" autocomplete="off" autocapitalize="off" spellcheck="false" class="cookie-secret w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 font-mono text-xs leading-6 text-on-surface outline-none transition placeholder:text-secondary/60 focus:border-primary focus:ring-4 focus:ring-primary/10" :class="{ 'is-visible': credentialVisible }" placeholder="serviceToken=…; userId=…; …" @input="credentialError = ''"></textarea>
            <div class="mt-2 flex items-start gap-2 text-xs text-secondary">
              <Shield class="mt-px h-4 w-4 text-primary flex-shrink-0" :stroke-width="2" />
              <span>必须包含有效的 <code>serviceToken</code>。Cookie 不会保存在浏览器、日志或本地备份中。</span>
            </div>
          </div>

          <div v-if="credentialError || store.error" class="flex items-start gap-2 rounded-xl bg-error-container/65 p-3 text-sm text-on-error-container">
            <AlertCircle class="h-4.5 w-4.5 flex-shrink-0 text-on-error-container" :stroke-width="2" />
            <span>{{ credentialError || store.error }}</span>
          </div>

          <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" class="rounded-xl px-4 py-2.5 text-sm font-bold text-secondary hover:bg-surface-container-high hover:text-primary" :disabled="store.savingCredentials" @click="refresh">重新检测</button>
            <button type="submit" class="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-on-primary shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45" :disabled="store.savingCredentials || !credentialCookie.trim()">
              <Loader2 v-if="store.savingCredentials" class="h-4.5 w-4.5 animate-spin" :stroke-width="2.5" />
              <Lock v-else class="h-4.5 w-4.5" :stroke-width="2" />
              {{ store.savingCredentials ? '正在加密保存…' : '安全保存并连接' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <!-- 未配置提示 -->
    <div v-else-if="!store.configured" class="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <section class="w-full max-w-2xl rounded-xl border border-outline-variant/30 bg-surface-bright p-6 shadow-sm md:p-8">
        <div class="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-tertiary-fixed text-tertiary">
          <KeyRound class="h-7 w-7 text-tertiary" :stroke-width="2" />
        </div>
        <h3 class="font-headline text-2xl font-bold text-on-surface">尚未配置小米云凭证</h3>
        <p class="mt-3 leading-7 text-secondary">{{ store.status?.message || store.error }}</p>
        <code class="mt-5 block overflow-x-auto rounded-lg bg-inverse-surface p-3 text-xs text-inverse-on-surface">XIAOMI_CLOUD_COOKIE="本人 i.mi.com 会话的完整 Cookie"</code>
        <button class="mt-6 rounded-xl bg-primary px-5 py-2.5 font-bold text-on-primary" @click="refresh">重新检测</button>
      </section>
    </div>

    <!-- 主工作区：二级侧边栏 + 沉浸式编辑区 -->
    <div v-else class="flex min-h-0 flex-1 overflow-hidden">
      <!-- 二级笔记列表侧边栏 -->
      <aside
        v-show="!secondarySidebarHidden || isMobile"
        class="relative flex min-h-0 flex-shrink-0 flex-col border-r border-outline-variant/20 bg-surface-container-low/55"
        :class="{ 'hidden md:flex': isMobile && editorMode !== 'empty' }"
        :style="{ width: isMobile ? '100%' : `${secondarySidebarWidth}px` }"
      >
        <div class="flex-shrink-0 p-3.5">
          <!-- 范围切换（使用中 / 收藏 / 已归档） -->
          <div class="mb-2.5 grid grid-cols-3 rounded-xl bg-surface-container-high p-1">
            <button class="rounded-lg px-2 py-1.5 text-[11px] font-bold transition" :class="noteScope === 'active' ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="noteScope = 'active'">全部</button>
            <button class="rounded-lg px-2 py-1.5 text-[11px] font-bold transition" :class="noteScope === 'favorite' ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="noteScope = 'favorite'">收藏</button>
            <button class="rounded-lg px-2 py-1.5 text-[11px] font-bold transition" :class="noteScope === 'archived' ? 'bg-surface-bright text-primary shadow-sm' : 'text-secondary'" @click="noteScope = 'archived'">归档</button>
          </div>

          <!-- 搜索输入 -->
          <label class="flex items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-bright px-3.5 py-2 focus-within:ring-2 focus-within:ring-primary/25">
            <Search class="h-4 w-4 text-secondary flex-shrink-0" :stroke-width="2" />
            <input v-model="searchQuery" class="w-full border-0 bg-transparent p-0 text-xs focus:ring-0" type="search" placeholder="搜索标题、正文与标签…" />
          </label>

          <!-- 文件夹筛选 -->
          <div class="mt-2.5 flex items-center gap-2">
            <Folder class="h-4 w-4 text-secondary flex-shrink-0" :stroke-width="2" />
            <select v-model="selectedFolder" class="min-w-0 flex-1 rounded-lg border-outline-variant/30 bg-surface-bright py-1 pl-2.5 pr-7 text-xs font-bold text-on-surface focus:border-primary focus:ring-primary/20">
              <option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">{{ folder.title }} ({{ folder.count }})</option>
            </select>
          </div>
        </div>

        <div v-if="store.error" class="mx-3.5 mb-2 flex items-start gap-2 rounded-xl bg-error-container/60 p-2.5 text-xs text-on-error-container">
          <AlertCircle class="h-4 w-4 text-on-error-container flex-shrink-0" :stroke-width="2" />
          <span class="min-w-0 flex-1">{{ store.error }}</span>
        </div>

        <!-- 笔记滚动列表 -->
        <div class="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-4">
          <div v-if="store.loading && !store.notes.length" class="space-y-2.5">
            <div v-for="index in 6" :key="index" class="h-20 animate-pulse rounded-xl bg-surface-container-high"></div>
          </div>
          <div v-else-if="!filteredNotes.length" class="flex h-full min-h-56 flex-col items-center justify-center px-6 text-center text-secondary">
            <FileText class="mb-2 h-10 w-10 text-outline/50" :stroke-width="1.5" />
            <p class="text-xs font-bold text-on-surface">{{ searchQuery ? '没有找到匹配笔记' : '暂无笔记' }}</p>
          </div>
          <template v-else>
            <button
              v-for="note in filteredNotes"
              :key="note.id"
              class="mb-2 w-full rounded-xl border p-3.5 text-left transition"
              :class="selectedId === note.id ? 'border-card-active-border/75 bg-surface-container-lowest shadow-sm ring-1 ring-card-active-ring text-on-surface' : 'border-transparent bg-surface-bright/70 hover:border-outline-variant/40 hover:bg-surface-container-high text-on-surface'"
              @click="selectNote(note)"
            >
              <div class="flex items-start justify-between gap-2">
                <h3
                  class="line-clamp-1 min-w-0 flex-1 text-sm font-bold transition-colors"
                  :class="selectedId === note.id ? 'text-primary' : 'text-on-surface'"
                >
                  {{ note.title }}
                </h3>
                <Star v-if="store.metadata[note.id]?.favorite" class="h-3.5 w-3.5 fill-amber-500 text-amber-500 flex-shrink-0" :stroke-width="1.5" />
                <time class="flex-shrink-0 text-[10px] text-secondary/70">{{ formatDate(note.modifyDate) }}</time>
              </div>
              <p class="mt-1.5 line-clamp-2 text-xs leading-5 text-secondary">{{ note.preview || '空白笔记' }}</p>
              <div v-if="store.metadata[note.id]?.tags?.length" class="mt-2 flex flex-wrap gap-1">
                <span v-for="tag in store.metadata[note.id].tags.slice(0, 3)" :key="tag" class="rounded-full bg-secondary-container px-2 py-0.5 text-[9px] font-bold text-on-secondary-container">#{{ tag }}</span>
              </div>
            </button>
          </template>
          <button v-if="!store.lastPage && !searchQuery" class="mt-2 w-full rounded-xl border border-outline-variant/40 bg-surface-bright py-2 text-xs font-bold text-primary disabled:opacity-50" :disabled="store.loadingMore" @click="store.loadNotes(false)">{{ store.loadingMore ? '正在加载…' : '加载更多' }}</button>
        </div>
      </aside>

      <!-- 拖拽调整宽度分隔线 -->
      <div
        v-if="!isMobile && !secondarySidebarHidden"
        class="group relative w-1.5 flex-shrink-0 cursor-col-resize touch-none bg-outline-variant/10 hover:bg-primary/25"
        role="separator"
        aria-label="拖动调整二级侧边栏宽度"
        @pointerdown="startSecondaryResize"
      >
        <div class="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-outline-variant group-hover:bg-primary"></div>
      </div>

      <!-- 右侧沉浸式编辑详情区 -->
      <section class="min-w-0 flex-1 bg-background" :class="{ 'hidden md:block': isMobile && editorMode === 'empty' }">
        <!-- 未选择笔记空白页 -->
        <div v-if="editorMode === 'empty'" class="flex h-full flex-col items-center justify-center p-8 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-container/30 text-primary shadow-sm">
            <FilePenLine class="h-8 w-8 text-primary" :stroke-width="2" />
          </div>
          <h3 class="mt-5 font-headline text-xl font-bold text-on-surface">选择或新建笔记</h3>
          <p class="mt-2 max-w-sm text-xs leading-6 text-secondary">沉浸式写作空间，支持纯文本与 Markdown 格式记录，随写随存。</p>
          <button
            class="mt-6 flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-on-primary shadow-sm transition hover:brightness-105"
            :disabled="!store.writable"
            @click="startNew"
          >
            <Plus class="h-4 w-4" :stroke-width="2.2" />
            <span>新建笔记</span>
          </button>
        </div>

        <!-- 纯净编辑状态 -->
        <div v-else class="flex h-full min-h-0 flex-col">
          <div v-if="store.loadingDetail" class="flex flex-1 items-center justify-center text-secondary">
            <Loader2 class="mr-2 h-4 w-4 animate-spin" :stroke-width="2.5" />正在加载正文…
          </div>

          <div v-else class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6 md:px-12 md:py-8">
            <!-- 笔记大标题 -->
            <input
              v-model="draft.title"
              maxlength="200"
              class="w-full border-0 bg-transparent p-0 font-headline text-2xl font-bold text-on-surface placeholder:text-outline/40 focus:ring-0 md:text-3xl"
              placeholder="无标题笔记"
            />

            <!-- 标题下方轻量元数据条：时间 · 字数 · 标签药丸 · 归档徽标 -->
            <div class="mt-3 flex flex-wrap items-center gap-2 border-b border-outline-variant/15 pb-4 text-[11px] text-secondary">
              <span v-if="store.selectedNote?.modifyDate">
                {{ formatDate(store.selectedNote.modifyDate) }}
              </span>
              <span>·</span>
              <span>{{ draft.content.length.toLocaleString() }} 字符</span>

              <span v-if="selectedMetadata?.archived" class="rounded-md bg-tertiary-fixed px-1.5 py-0.5 text-[10px] font-bold text-tertiary">
                已归档
              </span>

              <!-- 标签胶囊列表 -->
              <template v-if="selectedMetadata">
                <span class="text-outline-variant/60">|</span>
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    v-for="tag in selectedMetadata.tags"
                    :key="tag"
                    class="group inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2.5 py-0.5 text-[10px] font-bold text-on-surface-variant transition hover:bg-surface-container-highest"
                  >
                    #{{ tag }}
                    <button
                      class="opacity-40 hover:opacity-100 hover:text-error"
                      title="移除标签"
                      @click="removeTag(tag)"
                    >
                      <X class="h-2.5 w-2.5 leading-none" :stroke-width="2.5" />
                    </button>
                  </span>

                  <!-- 轻量添加标签入口 -->
                  <div v-if="tagInputVisible" class="flex items-center gap-1">
                    <input
                      ref="tagInputRef"
                      v-model="tagInput"
                      maxlength="32"
                      placeholder="标签名"
                      class="w-20 rounded-md border border-outline-variant/40 bg-surface-bright px-2 py-0.5 text-[10px] focus:border-primary focus:ring-1 focus:ring-primary/20"
                      @keydown.enter.prevent="addTag"
                      @keydown.esc="tagInputVisible = false"
                      @blur="addTag"
                    />
                  </div>
                  <button
                    v-else
                    class="inline-flex items-center gap-0.5 rounded-full border border-dashed border-outline-variant/50 px-2 py-0.5 text-[10px] font-bold text-secondary hover:border-primary hover:text-primary transition"
                    title="添加标签"
                    @click="showTagInput"
                  >
                    <Plus class="h-3 w-3 leading-none" :stroke-width="2.5" />
                    <span>标签</span>
                  </button>
                </div>
              </template>
            </div>

            <!-- 纯净无阻挡正文编辑区 -->
            <textarea
              ref="contentEditor"
              v-model="draft.content"
              maxlength="80000"
              class="mt-6 min-h-[60vh] w-full flex-1 resize-none border-0 bg-transparent p-0 font-body text-[15px] leading-8 text-on-surface placeholder:text-outline/40 focus:ring-0 selection:bg-primary-container selection:text-on-primary-container"
              placeholder="从这里开始输入正文… 随时使用 # 一级标题、## 二级标题进行排版"
            ></textarea>

            <!-- 底部极简状态提示 -->
            <div class="mt-4 flex items-center justify-between text-[10px] text-secondary/60">
              <span v-if="editorMode === 'edit' && store.selectedNote?.hasRichFormatting" class="text-tertiary font-bold">
                检测到富文本：修改正文将转为纯文本格式同步
              </span>
              <span v-else>
                按 Ctrl+S 手动保存 · 覆盖保存前自动生成快照
              </span>
              <span :class="isDirty ? 'text-tertiary font-bold' : ''">
                {{ isDirty ? '未保存修改' : '所有更改已同步' }}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 历史版本管理侧边抽屉 -->
    <Teleport to="body">
      <div v-if="historyOpen" class="fixed inset-0 z-[90] flex justify-end bg-black/25 backdrop-blur-[2px]" @click.self="historyOpen = false">
        <aside class="flex h-full w-full max-w-xl flex-col border-l border-outline-variant/30 bg-background shadow-2xl">
          <header class="flex items-start justify-between gap-3 border-b border-outline-variant/25 px-5 py-4">
            <div class="min-w-0">
              <h3 class="font-headline text-lg font-bold text-on-surface">{{ historyMode === 'archive' ? '历史归档库' : '本地历史版本' }}</h3>
              <p class="mt-0.5 text-xs text-secondary">synyFlow 本地加密快照，每篇笔记最多保留 60 个历史版本</p>
            </div>
            <button class="toolbar-button" aria-label="关闭历史" @click="historyOpen = false">
              <X class="h-4 w-4" :stroke-width="2" />
            </button>
          </header>

          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 px-5 py-3">
            <span class="min-w-0 text-xs text-secondary">{{ historyMode === 'archive' ? `${store.historyArchive.length} 个笔记历史组` : `当前共有 ${store.history.length} 个快照` }}</span>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <button v-if="historyTargetId && store.history.length" class="whitespace-nowrap rounded-lg border border-error/35 px-3 py-1.5 text-xs font-bold text-error disabled:opacity-40" :disabled="store.deletingHistory" @click="clearHistoryGroup">清理本篇历史</button>
              <button v-if="historyMode === 'current'" class="whitespace-nowrap rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs font-bold text-primary disabled:opacity-40" :disabled="isDirty || store.loadingHistory" @click="createCheckpoint">创建手动快照</button>
            </div>
          </div>

          <div v-if="store.historyError" class="m-4 rounded-xl bg-error-container/60 p-3 text-sm text-on-error-container">{{ store.historyError }}</div>
          <div v-if="(store.loadingHistory && !store.history.length) || (store.loadingArchive && !store.historyArchive.length)" class="flex flex-1 items-center justify-center text-secondary">
            <Loader2 class="mr-2 h-4 w-4 animate-spin" :stroke-width="2.5" />正在加载历史…
          </div>
          <div v-else class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] md:grid-rows-[minmax(190px,42%)_1fr]">
            <div class="overflow-y-auto px-3 pt-3 pb-4 md:border-b md:border-outline-variant/25" :class="{ 'hidden md:block': historyDetailVisible }">
              <template v-if="historyMode === 'archive' && !archiveSelectedNoteId">
                <button v-for="group in store.historyArchive" :key="group.noteId" class="mb-2 w-full rounded-xl border border-transparent bg-surface-container-low p-3 text-left hover:border-outline-variant/40" @click="selectArchiveGroup(group.noteId)">
                  <div class="flex items-center justify-between gap-2"><span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="group.deletedCandidate ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'">{{ group.deletedCandidate ? '删除前快照' : '历史分组' }}</span><time class="text-[10px] text-secondary">{{ formatFullDate(group.lastCapturedAt) }}</time></div>
                  <p class="mt-2 line-clamp-1 text-sm font-bold text-on-surface">{{ group.title }}</p><p class="mt-1 line-clamp-2 text-xs text-secondary">{{ group.preview || '空白版本' }}</p><p class="mt-2 text-[10px] font-bold text-primary">{{ group.versionCount }} 个版本</p>
                </button>
                <div v-if="!store.historyArchive.length" class="flex h-full min-h-40 flex-col items-center justify-center text-center text-secondary">
                  <Archive class="mb-2 h-8 w-8 text-secondary" :stroke-width="1.5" />
                  <p class="text-sm font-bold">暂无历史归档</p>
                </div>
              </template>
              <template v-else>
                <button v-if="historyMode === 'archive'" class="mb-3 flex items-center gap-1 text-xs font-bold text-primary" @click="backToArchiveGroups">
                  <ArrowLeft class="h-4 w-4" :stroke-width="2" />返回归档
                </button>
                <button
                  v-for="entry in store.history"
                  :key="entry.id"
                  class="mb-2 w-full rounded-xl border p-3 text-left transition"
                  :class="store.selectedHistory?.id === entry.id ? 'border-card-active-border/75 bg-surface-container-lowest ring-1 ring-card-active-ring shadow-sm text-on-surface' : 'border-transparent bg-surface-bright/70 hover:border-outline-variant/40 hover:bg-surface-container-high text-on-surface'"
                  @click="openHistoryVersion(entry.noteId, entry.id)"
                >
                  <div class="flex items-center justify-between gap-2"><span class="text-xs font-bold" :class="store.selectedHistory?.id === entry.id ? 'text-primary' : ''">{{ historyReasonLabel(entry.reason) }}</span><time class="text-[10px] text-secondary/70">{{ formatFullDate(entry.capturedAt) }}</time></div><p class="mt-1 line-clamp-1 text-sm font-bold" :class="store.selectedHistory?.id === entry.id ? 'text-primary' : 'text-on-surface'">{{ entry.title }}</p><p class="mt-1 line-clamp-2 text-xs text-secondary">{{ entry.preview || '空白版本' }}</p>
                </button>
                <div v-if="!store.history.length" class="flex h-full min-h-40 flex-col items-center justify-center text-center text-secondary">
                  <History class="mb-2 h-8 w-8 text-secondary" :stroke-width="1.5" />
                  <p class="text-sm font-bold">暂无历史版本</p>
                </div>
              </template>
            </div>
            <div class="min-h-0 flex-col p-4 sm:p-5" :class="historyDetailVisible ? 'flex' : 'hidden md:flex'">
              <template v-if="store.selectedHistory">
                <div class="flex flex-wrap items-start gap-3">
                  <button class="toolbar-button md:hidden" aria-label="返回历史版本列表" @click="historyDetailVisible = false">
                    <ArrowLeft class="h-4 w-4" :stroke-width="2" />
                  </button>
                  <div class="min-w-0 flex-1">
                    <h4 class="truncate font-headline text-base font-bold">{{ store.selectedHistory.title }}</h4>
                    <p class="mt-1 text-xs text-secondary">{{ formatFullDate(store.selectedHistory.capturedAt) }} · {{ historyReasonLabel(store.selectedHistory.reason) }}</p>
                  </div>
                  <div class="ml-auto flex flex-shrink-0 items-center gap-2">
                    <button class="toolbar-button text-error" title="删除这个历史版本" :disabled="store.deletingHistory" @click="deleteSelectedHistory">
                      <Trash2 class="h-4 w-4 text-error" :stroke-width="1.85" />
                    </button>
                    <button class="whitespace-nowrap rounded-xl bg-primary px-4 py-2 text-xs font-bold text-on-primary disabled:opacity-40" :disabled="store.restoring || !store.writable" @click="historyMode === 'archive' ? recreateHistoryVersion() : restoreHistory()">{{ store.restoring ? '处理中…' : (historyMode === 'archive' ? '重建笔记' : '恢复版本') }}</button>
                  </div>
                </div>
                <pre class="mt-4 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-container-low p-4 font-body text-xs leading-6 text-on-surface">{{ store.selectedHistory.content || '空白版本' }}</pre>
              </template>
              <div v-else class="flex flex-1 items-center justify-center text-xs text-secondary">选择一个历史版本查看正文</div>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>

    <!-- Toast 提示 -->
    <transition name="toast">
      <div v-if="toast" class="fixed left-1/2 top-6 z-[100] -translate-x-1/2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-on-primary shadow-xl">
        {{ toast }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.cookie-secret:not(.is-visible) { -webkit-text-security: disc; }
.toolbar-button {
  @apply flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-secondary transition hover:bg-surface-container-high hover:text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40;
}
.menu-enter-active, .menu-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.menu-enter-from, .menu-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}
.toast-enter-active, .toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -8px); }
:global(body.notes-resize-active) { cursor: col-resize; user-select: none; }
</style>
