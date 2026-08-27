<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Layers,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  FilePlus,
  MessageSquarePlus,
  ListPlus,
  Plus
} from 'lucide-vue-next'
import { useIsMobile } from './composables/useIsMobile'
import { usePrimarySidebar } from './composables/usePrimarySidebar'
import { useAppSettings } from './composables/useAppSettings'
import { useSidebarOrder, type SidebarItemDefinition } from './composables/useSidebarOrder'
import { useTaskStore } from './store/task'

const router = useRouter()
const route = useRoute()
const taskStore = useTaskStore()
const isMobile = useIsMobile()
const { primarySidebarCollapsed: desktopSidebarCollapsed, toggleCollapsed: togglePrimarySidebar } = usePrimarySidebar()
const { sidebarContainerSize } = useAppSettings()
const { sidebarItems, visibleSidebarItems, isReordering, draggingKey, reorderItems } = useSidebarOrder()

const desktopSidebarWidth = ref(256)
const desktopSidebarCollapsedWidth = ref(60)
const isSidebarResizing = ref(false)
const effectiveSidebarWidth = computed(() => desktopSidebarCollapsed.value ? desktopSidebarCollapsedWidth.value : desktopSidebarWidth.value)
let stopSidebarDrag: (() => void) | undefined

// 侧边栏图标长按与拖拽重排交互
let longPressTimer: ReturnType<typeof setTimeout> | undefined
let pressStartX = 0
let pressStartY = 0
const justFinishedDrag = ref(false)

function onPointerDownItem(item: SidebarItemDefinition, event: PointerEvent) {
  if (event.button !== 0) return
  clearTimeout(longPressTimer)
  pressStartX = event.clientX
  pressStartY = event.clientY

  longPressTimer = setTimeout(() => {
    isReordering.value = true
    draggingKey.value = item.key
    navigator.vibrate?.(40)

    window.addEventListener('pointermove', onPointerMoveDrag)
    window.addEventListener('pointerup', onPointerUpDrag)
    window.addEventListener('pointercancel', onPointerUpDrag)
  }, 320)

  window.addEventListener('pointermove', checkEarlyCancelMove, { passive: true })
  window.addEventListener('pointerup', onEarlyPointerUp, { once: true })
}

function checkEarlyCancelMove(event: PointerEvent) {
  if (!isReordering.value && longPressTimer) {
    const dist = Math.hypot(event.clientX - pressStartX, event.clientY - pressStartY)
    if (dist > 8) {
      clearTimeout(longPressTimer)
      longPressTimer = undefined
      window.removeEventListener('pointermove', checkEarlyCancelMove)
    }
  }
}

function onEarlyPointerUp() {
  clearTimeout(longPressTimer)
  longPressTimer = undefined
  window.removeEventListener('pointermove', checkEarlyCancelMove)
}

function onPointerMoveDrag(event: PointerEvent) {
  if (!isReordering.value || !draggingKey.value) return
  event.preventDefault()

  const listEl = document.querySelector('.sidebar-items-list') as HTMLElement | null
  if (!listEl) return

  const itemElements = Array.from(listEl.querySelectorAll<HTMLElement>('[data-sidebar-key]'))
  const currentIndex = sidebarItems.value.findIndex(i => i.key === draggingKey.value)
  if (currentIndex === -1) return

  const mouseY = event.clientY
  let targetIndex = currentIndex

  for (let i = 0; i < itemElements.length; i++) {
    const rect = itemElements[i].getBoundingClientRect()
    if (mouseY >= rect.top && mouseY <= rect.bottom) {
      targetIndex = i
      break
    } else if (i === 0 && mouseY < rect.top) {
      targetIndex = 0
      break
    } else if (i === itemElements.length - 1 && mouseY > rect.bottom) {
      targetIndex = itemElements.length - 1
      break
    }
  }

  if (targetIndex !== currentIndex && targetIndex >= 0 && targetIndex < sidebarItems.value.length) {
    reorderItems(currentIndex, targetIndex)
  }
}

function onPointerUpDrag() {
  clearTimeout(longPressTimer)
  longPressTimer = undefined
  window.removeEventListener('pointermove', checkEarlyCancelMove)
  window.removeEventListener('pointermove', onPointerMoveDrag)
  window.removeEventListener('pointerup', onPointerUpDrag)
  window.removeEventListener('pointercancel', onPointerUpDrag)

  if (isReordering.value) {
    justFinishedDrag.value = true
    isReordering.value = false
    draggingKey.value = null
    setTimeout(() => {
      justFinishedDrag.value = false
    }, 180)
  }
}

function handleItemClick(item: SidebarItemDefinition) {
  if (justFinishedDrag.value || isReordering.value) {
    return
  }
  navigateTo(item.path)
}

onMounted(() => {
  const savedWidth = Number(localStorage.getItem('terra_primary_sidebar_width'))
  if (Number.isFinite(savedWidth)) desktopSidebarWidth.value = Math.max(208, Math.min(360, savedWidth))

  const savedCollapsedWidth = Number(localStorage.getItem('terra_primary_sidebar_collapsed_width'))
  if (Number.isFinite(savedCollapsedWidth)) desktopSidebarCollapsedWidth.value = Math.max(50, Math.min(100, savedCollapsedWidth))

  const savedTheme = localStorage.getItem('taskflow_theme') || 'forest'
  const root = document.documentElement
  root.classList.remove('theme-ocean', 'theme-clay', 'theme-amber')
  if (savedTheme !== 'forest') root.classList.add(`theme-${savedTheme}`)

  // 在主界面加载完成后，利用后台空闲时段静默预热高频页面模块，消除初次进入时的卡顿
  const prefetchCoreRoutes = () => {
    void import('./views/AgentWorkspace.vue')
    void import('./views/XiaomiNotes.vue')
  }
  if (typeof window !== 'undefined') {
    if ('requestIdleCallback' in window) {
      ;(window as any).requestIdleCallback(prefetchCoreRoutes, { timeout: 2000 })
    } else {
      setTimeout(prefetchCoreRoutes, 800)
    }
  }
})

onBeforeUnmount(() => {
  stopSidebarDrag?.()
  clearTimeout(longPressTimer)
  window.removeEventListener('pointermove', checkEarlyCancelMove)
  window.removeEventListener('pointermove', onPointerMoveDrag)
  window.removeEventListener('pointerup', onPointerUpDrag)
})

function startSidebarResize(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  isSidebarResizing.value = true
  const startX = event.clientX
  const isCollapsed = desktopSidebarCollapsed.value
  const startWidth = isCollapsed ? desktopSidebarCollapsedWidth.value : desktopSidebarWidth.value
  document.body.classList.add('sidebar-resize-active')

  const move = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - startX
    if (isCollapsed) {
      desktopSidebarCollapsedWidth.value = Math.max(50, Math.min(100, startWidth + delta))
    } else {
      desktopSidebarWidth.value = Math.max(208, Math.min(360, startWidth + delta))
    }
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    window.removeEventListener('blur', stop)
    document.body.classList.remove('sidebar-resize-active')
    isSidebarResizing.value = false
    if (isCollapsed) {
      localStorage.setItem('terra_primary_sidebar_collapsed_width', String(Math.round(desktopSidebarCollapsedWidth.value)))
    } else {
      localStorage.setItem('terra_primary_sidebar_width', String(Math.round(desktopSidebarWidth.value)))
    }
    stopSidebarDrag = undefined
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
  window.addEventListener('pointercancel', stop, { once: true })
  window.addEventListener('blur', stop, { once: true })
  stopSidebarDrag = stop
}

const activeTab = computed(() => {
  const path = route.path
  if (path.startsWith('/agent') || path.startsWith('/chat')) return 'agent'
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
  ? { label: '新建笔记', icon: markRaw(FilePlus), path: '/xiaomi-notes?new=1' }
  : activeTab.value === 'agent'
    ? { label: '新对话', icon: markRaw(MessageSquarePlus), path: '/agent' }
    : { label: '新建 Todo', icon: markRaw(ListPlus), path: '/task-details' })

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

function navigateTo(path: string) {
  void router.push(path)
}
</script>

<template>
  <div class="min-h-screen overflow-hidden bg-background text-on-background font-body antialiased">
    <template v-if="!isMobile">
      <nav class="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-outline-variant/30 bg-surface-container-low py-6 md:flex" :class="{ 'sidebar-transition': !isSidebarResizing }" :style="{ width: `${effectiveSidebarWidth}px` }">
        <div class="mb-8 flex items-center gap-3" :class="desktopSidebarCollapsed ? 'justify-center px-0' : 'px-6'">
          <div
            class="flex flex-shrink-0 aspect-square items-center justify-center rounded-xl bg-primary text-on-primary shadow-sm transition-all duration-150 hover:scale-105"
            :class="desktopSidebarCollapsed ? '' : 'h-11 w-11'"
            :style="desktopSidebarCollapsed ? { width: `${sidebarContainerSize}px`, height: `${sidebarContainerSize}px` } : undefined"
          >
            <Layers class="h-5.5 w-5.5" :stroke-width="2" />
          </div>
          <div v-if="!desktopSidebarCollapsed" class="min-w-0">
            <h1 class="font-headline text-2xl font-bold leading-tight text-primary">synyFlow</h1>
            <p class="truncate text-[11px] font-bold uppercase tracking-widest text-secondary">Personal knowledge OS</p>
          </div>
        </div>

        <div class="mb-6" :class="desktopSidebarCollapsed ? 'px-0' : 'px-4'">
          <button
            class="flex items-center justify-center gap-2 bg-primary font-bold text-on-primary shadow-sm transition-all duration-150 hover:bg-surface-tint active:scale-95"
            :class="desktopSidebarCollapsed ? 'mx-auto aspect-square rounded-full px-0' : 'w-full rounded-xl px-4'"
            :style="desktopSidebarCollapsed
              ? { width: `${sidebarContainerSize}px`, height: `${sidebarContainerSize}px` }
              : { height: `${sidebarContainerSize}px` }"
            :title="desktopSidebarCollapsed ? primaryAction.label : undefined"
            :aria-label="primaryAction.label"
            @click="navigateTo(primaryAction.path)"
          >
            <span class="inline-flex h-6 w-6 flex-shrink-0 aspect-square items-center justify-center">
              <component
                :is="primaryAction.icon"
                class="h-5 w-5 flex-shrink-0"
                :stroke-width="2.2"
              />
            </span>
            <span v-if="!desktopSidebarCollapsed" class="truncate">{{ primaryAction.label }}</span>
          </button>
        </div>

        <TransitionGroup
          name="sidebar-reorder"
          tag="ul"
          class="sidebar-items-list flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
          :class="desktopSidebarCollapsed ? 'px-2' : 'px-3'"
        >
          <li
            v-for="item in visibleSidebarItems"
            :key="item.key"
            :data-sidebar-key="item.key"
            class="touch-none select-none relative"
          >
            <button
              class="group flex items-center gap-3 text-left text-sm font-bold transition-all duration-150 relative"
              :class="[
                desktopSidebarCollapsed ? 'mx-auto aspect-square justify-center rounded-full px-0' : 'w-full justify-start rounded-xl px-4',
                activeTab === item.key ? 'bg-primary-container text-on-primary-container shadow-xs' : 'text-secondary hover:bg-surface-container-high hover:text-primary',
                draggingKey === item.key ? 'scale-[1.04] shadow-xl ring-2 ring-primary/60 bg-surface-container-high z-40 cursor-grabbing !duration-75' : isReordering ? 'cursor-grab' : ''
              ]"
              :style="desktopSidebarCollapsed
                ? { width: `${sidebarContainerSize}px`, height: `${sidebarContainerSize}px` }
                : { height: `${sidebarContainerSize}px` }"
              :title="desktopSidebarCollapsed ? item.label : undefined"
              @pointerdown="onPointerDownItem(item, $event)"
              @click="handleItemClick(item)"
            >
              <span class="inline-flex h-6 w-6 flex-shrink-0 aspect-square items-center justify-center">
                <component
                  :is="item.icon"
                  class="h-5 w-5 flex-shrink-0 transition-transform duration-150 group-hover:scale-105"
                  :stroke-width="activeTab === item.key ? 2.25 : 1.85"
                />
              </span>
              <span v-if="!desktopSidebarCollapsed" class="min-w-0 truncate">{{ item.label }}</span>
            </button>
          </li>
        </TransitionGroup>

        <div class="mt-4 border-t border-outline-variant/30 pt-4" :class="desktopSidebarCollapsed ? 'mx-2' : 'mx-4'">
          <button
            class="group flex items-center gap-3 text-left text-sm font-bold transition-all duration-150"
            :class="[
              desktopSidebarCollapsed ? 'mx-auto aspect-square justify-center rounded-full px-0' : 'w-full justify-start rounded-xl px-4',
              activeTab === 'settings' ? 'bg-primary-container text-on-primary-container shadow-xs' : 'text-secondary hover:bg-surface-container-high hover:text-primary'
            ]"
            :style="desktopSidebarCollapsed
              ? { width: `${sidebarContainerSize}px`, height: `${sidebarContainerSize}px` }
              : { height: `${sidebarContainerSize}px` }"
            :title="desktopSidebarCollapsed ? '设置与连接器' : undefined"
            @click="navigateTo('/settings')"
          >
            <span class="inline-flex h-6 w-6 flex-shrink-0 aspect-square items-center justify-center">
              <Settings
                class="h-5 w-5 flex-shrink-0 transition-transform duration-150 group-hover:scale-105"
                :stroke-width="activeTab === 'settings' ? 2.25 : 1.85"
              />
            </span>
            <span v-if="!desktopSidebarCollapsed" class="min-w-0 truncate">设置与连接器</span>
          </button>
          <div class="mt-3 flex items-center gap-2 text-[11px] font-bold" :class="[desktopSidebarCollapsed ? 'justify-center px-0' : 'justify-start px-4', backendStatus.textClass]">
            <span class="h-2 w-2 flex-shrink-0 aspect-square rounded-full" :class="backendStatus.dotClass"></span>
            <span v-if="!desktopSidebarCollapsed" class="truncate">{{ backendStatus.label }}</span>
          </div>
          <button
            class="mt-3 flex items-center justify-center rounded-lg text-secondary transition-all duration-150 hover:bg-surface-container-high hover:text-primary"
            :class="desktopSidebarCollapsed ? 'mx-auto aspect-square rounded-full' : 'w-full'"
            :style="desktopSidebarCollapsed
              ? { width: `${Math.max(28, sidebarContainerSize - 4)}px`, height: `${Math.max(28, sidebarContainerSize - 4)}px` }
              : { height: `${Math.max(34, sidebarContainerSize - 4)}px` }"
            :aria-label="desktopSidebarCollapsed ? '展开一级侧边栏' : '折叠一级侧边栏'"
            :title="desktopSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
            @click="togglePrimarySidebar"
          >
            <component
              :is="desktopSidebarCollapsed ? PanelLeftOpen : PanelLeftClose"
              class="h-5 w-5 flex-shrink-0"
              :stroke-width="1.85"
            />
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
              <Layers class="h-5 w-5" :stroke-width="2" />
            </div>
            <div class="min-w-0">
              <h1 class="truncate font-headline text-xl font-bold leading-tight text-primary">synyFlow</h1>
              <div class="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold" :class="backendStatus.textClass">
                <span class="h-1.5 w-1.5 rounded-full" :class="backendStatus.dotClass"></span>
                {{ backendStatus.label }}
              </div>
            </div>
          </div>
          <button class="flex h-10 w-10 items-center justify-center rounded-full text-secondary transition hover:bg-surface-container-high" aria-label="打开设置" @click="navigateTo('/settings')">
            <Settings class="h-5 w-5" :stroke-width="1.85" />
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
        <Plus class="h-7 w-7" :stroke-width="2.5" />
      </button>

      <nav v-if="!isDetailsPage" class="mobile-bottom-nav no-scrollbar fixed bottom-0 z-50 flex w-full items-center justify-start overflow-x-auto rounded-t-xl border-t border-outline-variant/30 bg-surface-bright px-2 pt-2 shadow-[0_-4px_20px_rgba(46,50,48,0.08)]">
        <button
          v-for="item in visibleSidebarItems"
          :key="item.key"
          class="flex min-w-[4.25rem] flex-none flex-col items-center justify-center rounded-xl px-1 py-1.5 transition active:scale-90"
          :class="activeTab === item.key ? 'text-primary' : 'text-secondary hover:bg-surface-container-high'"
          @click="navigateTo(item.path)"
        >
          <component :is="item.icon" class="h-5 w-5" :stroke-width="activeTab === item.key ? 2.25 : 1.85" />
          <span class="mt-1 truncate text-[10px] font-bold">{{ item.mobileLabel }}</span>
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

/* 侧边栏拖拽重排丝滑 FLIP 动画 */
.sidebar-reorder-move {
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.sidebar-reorder-enter-active,
.sidebar-reorder-leave-active {
  transition: all 180ms ease;
}
</style>
