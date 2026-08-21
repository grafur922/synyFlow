<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIsMobile } from './composables/useIsMobile'
import { useTaskStore } from './store/task'

const router = useRouter()
const route = useRoute()
const taskStore = useTaskStore()
const isMobile = useIsMobile()
const desktopSidebarWidth = ref(256)
const desktopSidebarCollapsed = ref(false)
const isSidebarResizing = ref(false)
const effectiveSidebarWidth = computed(() => desktopSidebarCollapsed.value ? 76 : desktopSidebarWidth.value)
let stopSidebarDrag: (() => void) | undefined

onMounted(() => {
  const savedWidth = Number(localStorage.getItem('terra_primary_sidebar_width'))
  if (Number.isFinite(savedWidth)) desktopSidebarWidth.value = Math.max(208, Math.min(360, savedWidth))
  desktopSidebarCollapsed.value = localStorage.getItem('terra_primary_sidebar_collapsed') === 'true'

  const savedTheme = localStorage.getItem('taskflow_theme') || 'forest'
  const root = document.documentElement
  root.classList.remove('theme-ocean', 'theme-clay', 'theme-amber')
  if (savedTheme !== 'forest') root.classList.add(`theme-${savedTheme}`)
})

onBeforeUnmount(() => stopSidebarDrag?.())

function startSidebarResize(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  desktopSidebarCollapsed.value = false
  isSidebarResizing.value = true
  const startX = event.clientX
  const startWidth = desktopSidebarWidth.value
  document.body.classList.add('sidebar-resize-active')

  const move = (moveEvent: PointerEvent) => {
    desktopSidebarWidth.value = Math.max(208, Math.min(360, startWidth + moveEvent.clientX - startX))
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    window.removeEventListener('blur', stop)
    document.body.classList.remove('sidebar-resize-active')
    isSidebarResizing.value = false
    localStorage.setItem('terra_primary_sidebar_width', String(Math.round(desktopSidebarWidth.value)))
    stopSidebarDrag = undefined
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
  window.addEventListener('pointercancel', stop, { once: true })
  window.addEventListener('blur', stop, { once: true })
  stopSidebarDrag = stop
}

function togglePrimarySidebar() {
  desktopSidebarCollapsed.value = !desktopSidebarCollapsed.value
  localStorage.setItem('terra_primary_sidebar_collapsed', String(desktopSidebarCollapsed.value))
}


const activeTab = computed(() => {
  const path = route.path
  if (path === '/todo' || path === '/dashboard' || path === '/tasks' || path === '/') return 'todo'
  if (path.startsWith('/xiaomi-notes')) return 'xiaomi-notes'
  if (path.startsWith('/search')) return 'search'
  if (path.startsWith('/knowledge')) return 'knowledge'
  if (path.startsWith('/rss')) return 'rss'
  if (path.startsWith('/blog')) return 'blog'
  if (path.startsWith('/calendar')) return 'calendar'
  if (path.startsWith('/stats')) return 'stats'
  if (path.startsWith('/travel') || path.startsWith('/ai-plan')) return 'travel'
  if (path.startsWith('/settings')) return 'settings'
  return ''
})

const isDetailsPage = computed(() => route.path.startsWith('/task-details'))
const showTaskFab = computed(() => !isDetailsPage.value && activeTab.value === 'todo')
const primaryAction = computed(() => activeTab.value === 'xiaomi-notes'
  ? { label: '新建笔记', icon: 'note_add', path: '/xiaomi-notes?new=1' }
  : { label: '新建 Todo', icon: 'add_task', path: '/task-details' })

const backendStatus = computed(() => {
  if (!taskStore.backendConfigured) {
    return { label: 'Todo 本地模式', dotClass: 'bg-tertiary', textClass: 'text-tertiary' }
  }
  if (taskStore.backendOnline) {
    return { label: '在线', dotClass: 'bg-primary', textClass: 'text-primary' }
  }
  return {
    label: taskStore.loading ? '连接中' : '离线',
    dotClass: 'bg-error',
    textClass: 'text-error'
  }
})

const desktopItems = [
  { key: 'todo', label: 'Todo', icon: 'checklist', path: '/todo' },
  { key: 'xiaomi-notes', label: '小米笔记', icon: 'note_stack', path: '/xiaomi-notes' },
  { key: 'search', label: '全局搜索', icon: 'manage_search', path: '/search' },
  { key: 'knowledge', label: '知识库', icon: 'library_books', path: '/knowledge' },
  { key: 'rss', label: 'RSS 订阅', icon: 'rss_feed', path: '/rss' },
  { key: 'blog', label: '个人博客', icon: 'edit_square', path: '/blog' },
  { key: 'calendar', label: '日历', icon: 'calendar_month', path: '/calendar' },
  { key: 'travel', label: '路线规划', icon: 'route', path: '/travel' },
  { key: 'stats', label: '洞察', icon: 'insights', path: '/stats' }
]

const mobileItems = [
  { key: 'todo', label: 'Todo', icon: 'checklist', path: '/todo' },
  { key: 'xiaomi-notes', label: '笔记', icon: 'note_stack', path: '/xiaomi-notes' },
  { key: 'search', label: '搜索', icon: 'manage_search', path: '/search' },
  { key: 'knowledge', label: '知识', icon: 'library_books', path: '/knowledge' },
  { key: 'rss', label: 'RSS', icon: 'rss_feed', path: '/rss' },
  { key: 'blog', label: '博客', icon: 'edit_square', path: '/blog' },
  { key: 'calendar', label: '日历', icon: 'calendar_today', path: '/calendar' },
  { key: 'travel', label: '规划', icon: 'route', path: '/travel' },
  { key: 'stats', label: '洞察', icon: 'insights', path: '/stats' }
]

function navigateTo(path: string) {
  void router.push(path)
}
</script>

<template>
  <div class="min-h-screen overflow-hidden bg-background text-on-background font-body antialiased">
    <template v-if="!isMobile">
      <nav class="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-outline-variant/30 bg-surface-container-low py-6 md:flex" :class="{ 'sidebar-transition': !isSidebarResizing }" :style="{ width: `${effectiveSidebarWidth}px` }">
        <div class="mb-8 flex items-center gap-3" :class="desktopSidebarCollapsed ? 'justify-center px-0' : 'px-6'">
          <div class="flex h-11 w-11 flex-shrink-0 aspect-square items-center justify-center rounded-xl bg-primary text-on-primary shadow-sm">
            <span class="material-symbols-outlined">hub</span>
          </div>
          <div v-if="!desktopSidebarCollapsed" class="min-w-0">
            <h1 class="font-headline text-2xl font-bold leading-tight text-primary">Terra Hub</h1>
            <p class="truncate text-[11px] font-bold uppercase tracking-widest text-secondary">Personal knowledge OS</p>
          </div>
        </div>

        <div class="mb-6" :class="desktopSidebarCollapsed ? 'px-0' : 'px-4'">
          <button
            class="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary font-bold text-on-primary shadow-sm transition hover:bg-surface-tint active:scale-95" :class="desktopSidebarCollapsed ? 'mx-auto w-12 aspect-square rounded-full px-0' : 'w-full px-4'"
            @click="navigateTo(primaryAction.path)"
          >
            <span class="inline-flex h-6 w-6 flex-shrink-0 aspect-square items-center justify-center"><span class="material-symbols-outlined">{{ primaryAction.icon }}</span></span>
            <span v-if="!desktopSidebarCollapsed">{{ primaryAction.label }}</span>
          </button>
        </div>

        <ul class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" :class="desktopSidebarCollapsed ? 'px-2' : 'px-3'">
          <li v-for="item in desktopItems" :key="item.key">
            <button
              class="flex h-12 items-center gap-3 rounded-xl text-left text-sm font-bold transition-colors"
              :class="[desktopSidebarCollapsed ? 'mx-auto w-12 aspect-square justify-center rounded-full px-0' : 'w-full justify-start px-4', activeTab === item.key ? 'bg-primary-container text-on-primary-container' : 'text-secondary hover:bg-surface-container-high hover:text-primary']"
              @click="navigateTo(item.path)"
            >
              <span class="inline-flex h-6 w-6 flex-shrink-0 aspect-square items-center justify-center"><span class="material-symbols-outlined" :class="{ filled: activeTab === item.key }">{{ item.icon }}</span></span>
              <span v-if="!desktopSidebarCollapsed">{{ item.label }}</span>
            </button>
          </li>
        </ul>

        <div class="mt-4 border-t border-outline-variant/30 pt-4" :class="desktopSidebarCollapsed ? 'mx-2' : 'mx-4'">
          <button
            class="flex h-12 items-center gap-3 rounded-xl text-left text-sm font-bold transition-colors"
            :class="[desktopSidebarCollapsed ? 'mx-auto w-12 aspect-square justify-center rounded-full px-0' : 'w-full justify-start px-4', activeTab === 'settings' ? 'bg-primary-container text-on-primary-container' : 'text-secondary hover:bg-surface-container-high hover:text-primary']"
            @click="navigateTo('/settings')"
          >
            <span class="inline-flex h-6 w-6 flex-shrink-0 aspect-square items-center justify-center"><span class="material-symbols-outlined">settings</span></span>
            <span v-if="!desktopSidebarCollapsed">设置与连接器</span>
          </button>
          <div class="mt-3 flex items-center gap-2 text-[11px] font-bold" :class="[desktopSidebarCollapsed ? 'justify-center px-0' : 'justify-start px-4', backendStatus.textClass]">
            <span class="h-2 w-2 flex-shrink-0 aspect-square rounded-full" :class="backendStatus.dotClass"></span>
            <span v-if="!desktopSidebarCollapsed">{{ backendStatus.label }}</span>
          </div>
          <button class="mt-3 flex h-10 items-center justify-center rounded-lg text-secondary hover:bg-surface-container-high hover:text-primary" :class="desktopSidebarCollapsed ? 'mx-auto w-10 aspect-square rounded-full' : 'w-full'" :aria-label="desktopSidebarCollapsed ? '展开一级侧边栏' : '折叠一级侧边栏'" @click="togglePrimarySidebar">
            <span class="material-symbols-outlined text-[20px]">{{ desktopSidebarCollapsed ? 'right_panel_open' : 'left_panel_close' }}</span>
          </button>
        </div>
        <div class="absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none hover:bg-primary/25" role="separator" aria-label="拖动调整一级侧边栏宽度" @pointerdown="startSidebarResize"></div>
      </nav>

      <main class="hidden h-screen overflow-hidden md:block" :class="{ 'sidebar-main-transition': !isSidebarResizing }" :style="{ marginLeft: `${effectiveSidebarWidth}px`, width: `calc(100% - ${effectiveSidebarWidth}px)` }">
        <router-view />
      </main>
    </template>

    <div v-else class="mobile-shell flex w-full flex-col overflow-x-hidden md:hidden">
      <header v-if="!isDetailsPage" class="mobile-top-appbar sticky top-0 z-40 flex-shrink-0 border-b border-outline-variant/20 bg-background/95 backdrop-blur-xl">
        <div class="flex w-full items-center justify-between px-5 py-3.5">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary shadow-sm">
              <span class="material-symbols-outlined text-[21px]">hub</span>
            </div>
            <div class="min-w-0">
              <h1 class="truncate font-headline text-xl font-bold leading-tight text-primary">Terra Hub</h1>
              <div class="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold" :class="backendStatus.textClass">
                <span class="h-1.5 w-1.5 rounded-full" :class="backendStatus.dotClass"></span>
                {{ backendStatus.label }}
              </div>
            </div>
          </div>
          <button class="flex h-10 w-10 items-center justify-center rounded-full text-secondary transition hover:bg-surface-container-high" aria-label="打开设置" @click="navigateTo('/settings')">
            <span class="material-symbols-outlined">settings</span>
          </button>
        </div>
      </header>

      <main class="min-h-0 flex-grow overflow-y-auto" :class="{ 'mobile-content-safe': !isDetailsPage }">
        <router-view />
      </main>

      <button
        v-if="showTaskFab"
        class="mobile-fab fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-on-primary shadow-xl transition-transform active:scale-90"
        aria-label="新建 Todo"
        @click="navigateTo('/task-details')"
      >
        <span class="material-symbols-outlined text-3xl">add</span>
      </button>

      <nav v-if="!isDetailsPage" class="mobile-bottom-nav no-scrollbar fixed bottom-0 z-50 flex w-full items-center justify-start overflow-x-auto rounded-t-xl border-t border-outline-variant/30 bg-surface-bright px-2 pt-2 shadow-[0_-4px_20px_rgba(46,50,48,0.08)]">
        <button
          v-for="item in mobileItems"
          :key="item.key"
          class="flex min-w-[4.25rem] flex-none flex-col items-center justify-center rounded-xl px-1 py-1.5 transition active:scale-90"
          :class="activeTab === item.key ? 'text-primary' : 'text-secondary hover:bg-surface-container-high'"
          @click="navigateTo(item.path)"
        >
          <span class="material-symbols-outlined text-[22px]" :class="{ filled: activeTab === item.key }">{{ item.icon }}</span>
          <span class="mt-1 truncate text-[10px] font-bold">{{ item.label }}</span>
        </button>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.sidebar-transition { transition: width 180ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.sidebar-main-transition { transition: margin-left 180ms cubic-bezier(0.2, 0.8, 0.2, 1), width 180ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.mobile-shell {
  height: 100vh;
  height: 100dvh;
}
.mobile-top-appbar { padding-top: env(safe-area-inset-top, 0px); }
.mobile-content-safe { padding-bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px)); }
.mobile-fab { bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px)); }
.mobile-bottom-nav { padding-bottom: max(0.65rem, calc(env(safe-area-inset-bottom, 0px) + 0.4rem)); }
:global(body.sidebar-resize-active) { cursor: col-resize; user-select: none; }
</style>
