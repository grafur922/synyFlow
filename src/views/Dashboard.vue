<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search,
  Bell,
  HelpCircle,
  PieChart,
  Timer,
  AlertCircle,
  ArrowRight,
  ChevronRight,
  Circle,
  CheckCircle2,
  Clock,
  Trash2,
  Check,
  CheckSquare,
  Quote
} from 'lucide-vue-next'
import { useTaskStore } from '../store/task'
import { useIsMobile } from '../composables/useIsMobile'
import { useAppSettings } from '../composables/useAppSettings'
import { toLocalDateString } from '../shared/date'

const router = useRouter()
const taskStore = useTaskStore()
const isMobile = useIsMobile()
const { urgentCarouselInterval } = useAppSettings()

// 本地分类选择状态 (移动端)
const selectedCategory = ref('全部')

// 搜索框输入状态
const searchQuery = ref('')

// 紧急任务上下轮播逻辑
const currentUrgentIndex = ref(0)
let urgentCarouselTimer: number | null = null
const isUrgentPaused = ref(false)

const currentUrgentTask = computed(() => {
  const tasks = taskStore.urgentTasks
  if (!tasks.length) return null
  return tasks[currentUrgentIndex.value % tasks.length]
})

function startUrgentCarousel() {
  stopUrgentCarousel()
  if (taskStore.urgentTasks.length <= 1) return
  const intervalMs = Math.max(1000, Math.round((urgentCarouselInterval.value || 4) * 1000))
  urgentCarouselTimer = window.setInterval(() => {
    if (!isUrgentPaused.value && taskStore.urgentTasks.length > 1) {
      currentUrgentIndex.value = (currentUrgentIndex.value + 1) % taskStore.urgentTasks.length
    }
  }, intervalMs)
}

function stopUrgentCarousel() {
  if (urgentCarouselTimer) {
    clearInterval(urgentCarouselTimer)
    urgentCarouselTimer = null
  }
}

watch([() => taskStore.urgentTasks.length, urgentCarouselInterval], ([newLen]) => {
  if (currentUrgentIndex.value >= newLen) {
    currentUrgentIndex.value = 0
  }
  startUrgentCarousel()
}, { immediate: true })

onMounted(() => {
  startUrgentCarousel()
})

onBeforeUnmount(() => {
  stopUrgentCarousel()
  stopHeaderDrag?.()
})

// 桌面端 Header 隐形下边缘拖拽微调 (48px ~ 64px，最大 64px 仅可往上缩小)
const savedHeaderHeight = Number(localStorage.getItem('synyflow_dashboard_header_height'))
const desktopHeaderHeight = ref(
  Number.isFinite(savedHeaderHeight) && savedHeaderHeight >= 48 && savedHeaderHeight <= 64 ? savedHeaderHeight : 52
)
const isHeaderResizing = ref(false)
let stopHeaderDrag: (() => void) | undefined

const headerShrinkRatio = computed(() => {
  const clamped = Math.max(48, Math.min(64, desktopHeaderHeight.value))
  return (64 - clamped) / (64 - 48)
})

function startHeaderResize(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  isHeaderResizing.value = true
  const startY = event.clientY
  const startHeight = desktopHeaderHeight.value
  document.body.classList.add('header-resize-active')

  const move = (moveEvent: PointerEvent) => {
    const nextHeight = Math.max(48, Math.min(64, startHeight + (moveEvent.clientY - startY)))
    desktopHeaderHeight.value = nextHeight
  }

  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    window.removeEventListener('blur', stop)
    document.body.classList.remove('header-resize-active')
    isHeaderResizing.value = false
    localStorage.setItem('synyflow_dashboard_header_height', String(Math.round(desktopHeaderHeight.value)))
    stopHeaderDrag = undefined
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
  window.addEventListener('pointercancel', stop, { once: true })
  window.addEventListener('blur', stop, { once: true })
  stopHeaderDrag = stop
}

function toggleHeaderCompact() {
  desktopHeaderHeight.value = desktopHeaderHeight.value <= 54 ? 64 : 48
  localStorage.setItem('synyflow_dashboard_header_height', String(Math.round(desktopHeaderHeight.value)))
}

// 侧边栏/分类过滤器逻辑
const categories = ['全部', '工作', '个人', '学习']

// 任务过滤逻辑
const filteredTasks = computed(() => {
  let result = taskStore.tasks
  
  // 1. 分类过滤
  if (selectedCategory.value !== '全部') {
    result = result.filter(t => t.category === selectedCategory.value)
  }
  
  // 2. 搜索过滤
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(t => 
      t.title.toLowerCase().includes(q) || 
      t.notes.toLowerCase().includes(q)
    )
  }
  
  return result
})

// 今天到期的任务
const today = toLocalDateString()
const todayTasks = computed(() => {
  return taskStore.tasksByDateMap[today] ?? []
})

const pendingTodayTasksCount = computed(() => {
  return todayTasks.value.filter(t => !t.completed).length
})

// 改变任务完成状态
const toggleComplete = (id: string, event?: Event) => {
  if (event) {
    event.stopPropagation()
  }
  taskStore.toggleTaskCompleted(id)
}

// 跳转到新增/编辑
const navigateToDetails = (id?: string) => {
  if (id) {
    router.push(`/task-details/${id}`)
  } else {
    router.push('/task-details')
  }
}

// 专注时间柱状图高度计算比例
const barHeights = [40, 60, 90, 100, 30] // 对应 M, T, W, T, F 专注时间百分比
</script>

<template>
  <div class="flex-1 flex flex-col w-full h-full overflow-hidden bg-background">
    
    <!-- ==================== DESKTOP HEADER ==================== -->
    <header
      v-if="!isMobile"
      class="hidden md:flex justify-between items-center px-8 bg-background/80 backdrop-blur-md shadow-sm z-10 sticky top-0 flex-shrink-0 relative select-none"
      :style="{ height: `${desktopHeaderHeight}px` }"
      :class="{ 'transition-[height] duration-150': !isHeaderResizing }"
    >
      <div class="flex items-center gap-3">
        <h2
          class="font-headline font-bold text-primary dark:text-primary-fixed-dim tracking-tight transition-[font-size]"
          :style="{ fontSize: `${22 - headerShrinkRatio * 5}px` }"
        >
          待办工作台
        </h2>
      </div>
      
      <div class="flex-1 max-w-md mx-6">
        <div
          class="relative focus-within:ring-2 focus-within:ring-primary/50 rounded-full bg-surface-container-highest flex items-center border border-outline-variant/20 transition-all"
          :style="{
            height: `${38 - headerShrinkRatio * 10}px`,
            paddingLeft: `${14 - headerShrinkRatio * 3}px`,
            paddingRight: `${14 - headerShrinkRatio * 3}px`
          }"
        >
          <Search
            class="text-on-surface-variant mr-1.5 flex-shrink-0 transition-all"
            :style="{
              width: `${17 - headerShrinkRatio * 3.5}px`,
              height: `${17 - headerShrinkRatio * 3.5}px`
            }"
            :stroke-width="2"
          />
          <input 
            v-model="searchQuery"
            class="bg-transparent border-none outline-none text-on-surface w-full placeholder:text-on-surface-variant font-body focus:ring-0 focus:outline-none leading-none p-0 transition-[font-size]"
            :style="{ fontSize: `${13.5 - headerShrinkRatio * 2}px` }"
            placeholder="搜索待办、分类或备注..."
            type="text"
          />
        </div>
      </div>
      
      <div class="flex items-center" :style="{ gap: `${10 - headerShrinkRatio * 4}px` }">
        <button
          class="text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-all flex items-center justify-center aspect-square"
          :style="{
            width: `${36 - headerShrinkRatio * 8}px`,
            height: `${36 - headerShrinkRatio * 8}px`
          }"
          title="通知"
        >
          <Bell
            class="transition-all"
            :style="{
              width: `${18 - headerShrinkRatio * 3.5}px`,
              height: `${18 - headerShrinkRatio * 3.5}px`
            }"
            :stroke-width="1.85"
          />
        </button>
        <button
          class="text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-all flex items-center justify-center aspect-square"
          :style="{
            width: `${36 - headerShrinkRatio * 8}px`,
            height: `${36 - headerShrinkRatio * 8}px`
          }"
          title="帮助"
        >
          <HelpCircle
            class="transition-all"
            :style="{
              width: `${18 - headerShrinkRatio * 3.5}px`,
              height: `${18 - headerShrinkRatio * 3.5}px`
            }"
            :stroke-width="1.85"
          />
        </button>
      </div>

      <!-- 底部隐形拖拽热区（无任何视觉把手，鼠标悬停于下边缘时即可微调） -->
      <div
        class="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize touch-none z-20"
        @pointerdown="startHeaderResize"
        @dblclick="toggleHeaderCompact"
      ></div>
    </header>

    <!-- Scrollable Content -->
    <div class="flex-1 overflow-y-auto p-6 md:p-8">
      
      <!-- ==================== DESKTOP DASHBOARD ==================== -->
      <div v-if="!isMobile" class="hidden md:block">
        <!-- Welcome Section -->
        <section class="mb-8">
          <h2 class="font-headline text-4xl font-bold text-on-surface mb-2">早上好，管理员</h2>
          <p class="font-body text-secondary text-lg">
            今天您有 <span class="text-primary font-bold">{{ pendingTodayTasksCount }}</span> 项待办待处理。开启效率满满的一天吧。
          </p>
        </section>

        <!-- Bento Grid Widgets -->
        <section class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <!-- Completion Rate Card -->
          <div class="bg-surface-bright rounded-xl p-6 shadow-[0_4px_20px_rgba(46,50,48,0.06)] border border-outline-variant/20 flex flex-col items-center justify-center relative overflow-hidden">
            <div class="mb-4 flex w-full items-center gap-2 self-stretch">
              <PieChart class="h-5 w-5 text-primary flex-shrink-0" :stroke-width="2" />
              <h3 class="font-body text-secondary text-sm font-semibold tracking-wide">本周完成率</h3>
            </div>
            <!-- Circular Progress (CSS based) -->
            <div class="relative h-32 w-32 aspect-square flex items-center justify-center mb-2">
              <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <!-- Background circle -->
                <circle class="text-surface-container-high" cx="50" cy="50" fill="transparent" r="40" stroke="currentColor" stroke-width="8"></circle>
                <!-- Progress circle -->
                <circle 
                  class="text-primary transition-all duration-1000 ease-out circle-progress-anim" 
                  cx="50" 
                  cy="50" 
                  fill="transparent" 
                  r="40" 
                  stroke="currentColor" 
                  stroke-width="8"
                  :stroke-dasharray="251.2"
                  :stroke-dashoffset="251.2 - (251.2 * taskStore.completionRate) / 100"
                  :style="{ '--target-offset': 251.2 - (251.2 * taskStore.completionRate) / 100 }"
                ></circle>
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <span class="font-headline text-3xl font-bold text-on-surface">{{ taskStore.completionRate }}%</span>
              </div>
            </div>
            <p class="text-xs text-secondary mt-2">较上周提升 12%</p>
          </div>

          <!-- Focus Hours Card -->
          <div class="bg-surface-bright rounded-xl p-6 shadow-[0_4px_20px_rgba(46,50,48,0.06)] border border-outline-variant/20 flex flex-col justify-between">
            <div class="flex justify-between items-start mb-4">
              <div>
                <Timer class="h-5 w-5 text-tertiary mb-2" :stroke-width="2" />
                <h3 class="font-body text-secondary text-sm font-semibold tracking-wide">专注时长</h3>
              </div>
              <span class="bg-tertiary-container/30 text-on-tertiary-container text-xs px-2 py-1 rounded-full font-bold">This Week</span>
            </div>
            <div>
              <div class="flex items-baseline gap-2 mb-4">
                <span class="font-headline text-4xl font-bold text-on-surface">{{ taskStore.focusHours }}</span>
                <span class="text-secondary font-body">小时</span>
              </div>
              <!-- Mini bar chart -->
              <div class="flex items-end gap-2 h-16 w-full mt-4">
                <div 
                  v-for="(h, idx) in barHeights" 
                  :key="idx" 
                  class="w-1/5 rounded-t-sm transition-all duration-500 bar-anim"
                  :class="idx === 3 ? 'bg-primary' : 'bg-primary/40'"
                  :style="{ height: h + '%', 'animation-delay': (idx * 0.1) + 's' }"
                ></div>
              </div>
              <div class="flex justify-between text-[10px] text-secondary mt-1 px-1">
                <span>周一</span><span>周二</span><span>周三</span><span>周四</span><span>周五</span>
              </div>
            </div>
          </div>

          <!-- Urgent Tasks Card -->
          <div class="bg-primary rounded-xl p-6 shadow-[0_4px_20px_rgba(46,50,48,0.06)] flex flex-col text-on-primary relative overflow-hidden group">
            <div class="absolute -right-10 -top-10 w-40 h-40 bg-on-primary-fixed-variant/20 rounded-full blur-2xl group-hover:bg-on-primary-fixed-variant/30 transition-colors duration-500"></div>
            <div class="flex items-center justify-between mb-6 z-10">
              <div class="flex items-center gap-2">
                <AlertCircle class="h-4.5 w-4.5" :stroke-width="2.2" />
                <h3 class="font-body text-on-primary/90 text-sm font-semibold tracking-wide">需要关注</h3>
              </div>
              <span v-if="taskStore.urgentTasks.length > 1" class="text-[11px] font-bold bg-on-primary-fixed-variant/40 px-2 py-0.5 rounded-full text-on-primary/90">
                {{ (currentUrgentIndex % taskStore.urgentTasks.length) + 1 }} / {{ taskStore.urgentTasks.length }}
              </span>
            </div>
            <div class="mb-4 z-10">
              <span class="font-headline text-5xl font-bold">{{ taskStore.urgentTasks.length }}</span>
              <p class="text-on-primary/80 mt-1">项重要任务待处理</p>
            </div>
            <div 
              class="mt-auto z-10"
              @mouseenter="isUrgentPaused = true"
              @mouseleave="isUrgentPaused = false"
            >
              <div 
                v-if="currentUrgentTask"
                class="relative h-[46px] overflow-hidden rounded-lg bg-on-primary-fixed-variant/40 backdrop-blur-sm"
              >
                <Transition name="urgent-slide">
                  <div
                    :key="currentUrgentTask.id"
                    @click="navigateToDetails(currentUrgentTask.id)"
                    class="absolute inset-0 px-3 flex justify-between items-center cursor-pointer hover:bg-on-primary-fixed-variant/60 transition-colors"
                  >
                    <span class="text-sm font-semibold truncate pr-2">{{ currentUrgentTask.title }}</span>
                    <ArrowRight class="h-4 w-4 flex-shrink-0" :stroke-width="2" />
                  </div>
                </Transition>
              </div>
              <div v-else class="text-xs text-on-primary/70 italic py-2">
                暂无高优先级重要任务，做得很棒！
              </div>
            </div>
          </div>
        </section>

        <!-- Upcoming Tasks Section -->
        <section>
          <div class="flex justify-between items-center mb-6">
            <h2 class="font-headline text-2xl font-bold text-on-surface">即将到期</h2>
            <button 
              @click="router.push('/calendar')"
              class="text-primary font-semibold text-sm hover:underline flex items-center gap-1"
            >
              查看日程 <ChevronRight class="h-4 w-4" :stroke-width="2" />
            </button>
          </div>
          <div class="space-y-4">
            <div 
              v-for="task in filteredTasks" 
              :key="task.id"
              @click="navigateToDetails(task.id)"
              :class="{ 'opacity-70': task.completed }"
              class="bg-surface-bright rounded-[12px] p-5 shadow-[0_4px_20px_rgba(46,50,48,0.06)] border border-outline-variant/20 hover:border-primary/30 transition-colors flex flex-col md:flex-row md:items-center gap-4 group cursor-pointer"
            >
              <div 
                @click="toggleComplete(task.id, $event)"
                class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full cursor-pointer transition-colors duration-200"
                :class="task.completed ? 'bg-primary-container/20 text-primary' : 'bg-surface-container-high text-secondary hover:bg-primary/10 hover:text-primary'"
              >
                <component
                  :is="task.completed ? CheckCircle2 : Circle"
                  class="h-5 w-5 transition-transform group-hover:scale-105"
                  :stroke-width="task.completed ? 2.2 : 1.85"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="bg-secondary-container text-on-secondary-container text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    {{ task.category }}
                  </span>
                  <span 
                    v-if="task.timeStart"
                    :class="task.priority === 'High' ? 'text-error' : 'text-secondary'"
                    class="text-xs font-bold flex items-center gap-1"
                  >
                    <Clock class="h-3.5 w-3.5" :stroke-width="2" /> 
                    {{ task.timeStart }} {{ task.timeEnd ? '- ' + task.timeEnd : '' }}
                  </span>
                  <span 
                    v-if="task.priority === 'High'"
                    class="bg-error-container text-on-error-container text-[9px] px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wide"
                  >
                    重要
                  </span>
                </div>
                <h4 
                  :class="{ 'line-through text-secondary': task.completed }"
                  class="font-headline text-lg font-bold text-on-surface truncate group-hover:text-primary transition-colors"
                >
                  {{ task.title }}
                </h4>
                <p class="text-sm text-secondary truncate">{{ task.notes || '暂无备注' }}</p>
              </div>
              <div class="flex items-center justify-between md:justify-end gap-6 mt-4 md:mt-0">
                <div class="flex -space-x-2">
                  <div class="w-8 h-8 rounded-full border-2 border-surface-bright bg-surface-container-high flex items-center justify-center text-xs font-bold text-secondary z-10">+1</div>
                </div>
                <button 
                  @click.stop="taskStore.deleteTask(task.id)"
                  class="w-8 h-8 flex items-center justify-center rounded-full text-secondary hover:bg-error-container hover:text-error transition-colors"
                  title="删除任务"
                >
                  <Trash2 class="h-4 w-4" :stroke-width="1.85" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- ==================== MOBILE PORTRAIT (< 768px) ==================== -->
      <div v-else class="block md:hidden">
        <!-- Hero Progress Header -->
        <section class="mt-2 mb-6 animate-entrance" style="animation-delay: 0.04s;">
          <div class="flex justify-between items-end mb-1">
            <h2 class="font-headline text-3xl font-bold text-on-background">今天</h2>
            <span class="font-label text-xs font-semibold text-primary">{{ taskStore.completionRate }}% 完成</span>
          </div>
          <!-- Progress Bar -->
          <div class="w-full h-1 bg-surface-container-high rounded-full mt-4 overflow-hidden">
            <div class="h-full bg-primary rounded-full progress-bar-animate" :style="{ '--target-width': taskStore.completionRate + '%', width: taskStore.completionRate + '%' }"></div>
          </div>
        </section>

        <!-- Horizontal Scrollable Category Chips -->
        <div class="flex gap-2 overflow-x-auto no-scrollbar pb-4 -mx-6 px-6 animate-entrance" style="animation-delay: 0.08s;">
          <button 
            v-for="cat in categories" 
            :key="cat"
            @click="selectedCategory = cat"
            :class="selectedCategory === cat ? 'bg-primary text-on-primary font-semibold shadow-sm' : 'bg-surface-container-low text-on-surface-variant border border-outline-variant/30 font-medium'"
            class="whitespace-nowrap px-5 py-2 rounded-full text-xs active:scale-95 transition-transform duration-200"
          >
            {{ cat }}
          </button>
        </div>

        <!-- Task List Area -->
        <div class="mt-4 flex flex-col gap-3">
          <div 
            v-for="(task, index) in filteredTasks" 
            :key="task.id"
            @click="navigateToDetails(task.id)"
            :class="[
              task.completed ? 'bg-surface-container-low/50 border-transparent opacity-75' : 'bg-surface-container-lowest border-outline-variant/20 shadow-[0_4px_20px_rgba(46,50,48,0.02)]'
            ]"
            class="task-row group flex items-center gap-4 p-4 border rounded-xl animate-entrance cursor-pointer"
            :style="{ 'animation-delay': (0.12 + index * 0.04) + 's' }"
          >
            <!-- Custom Animated Checkbox Ring -->
            <div class="flex-shrink-0 cursor-pointer p-1" @click.stop="toggleComplete(task.id)">
              <div 
                :class="task.completed ? 'bg-primary border-primary' : 'bg-transparent border-outline-variant'"
                class="checkbox-ring w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200"
              >
                <Check 
                  :class="task.completed ? 'opacity-100 scale-100' : 'opacity-0 scale-75'"
                  class="text-on-primary h-3.5 w-3.5 check-icon transition-all duration-300"
                  :stroke-width="3"
                />
              </div>
            </div>
            
            <div class="flex-grow min-w-0">
              <h3 
                :class="{ 'line-through opacity-50': task.completed }"
                class="font-semibold text-base text-on-background leading-snug truncate transition-all duration-300"
              >
                {{ task.title }}
              </h3>
              <div class="flex items-center gap-2 mt-2 flex-wrap">
                <span v-if="task.timeStart" class="text-xs text-on-surface-variant opacity-60 flex items-center gap-1 font-medium">
                  <Clock class="h-3.5 w-3.5" :stroke-width="2" />
                  {{ task.timeStart }}{{ task.timeEnd ? ' - ' + task.timeEnd : '' }}
                </span>
                <span v-if="task.timeStart" class="w-1 h-1 rounded-full bg-outline-variant"></span>
                <span 
                  :class="[
                    task.category === '工作' ? 'text-primary' : '',
                    task.category === '个人' ? 'text-tertiary' : '',
                    task.category === '学习' ? 'text-primary' : 'text-on-surface-variant'
                  ]"
                  class="text-xs font-bold uppercase tracking-wider"
                >
                  {{ task.category }}
                </span>
              </div>
            </div>
            
            <!-- Quick Delete Button -->
            <button 
              @click.stop="taskStore.deleteTask(task.id)"
              class="text-on-surface-variant/40 hover:text-error hover:bg-error-container/20 rounded-full p-2 transition-colors shrink-0 active:scale-90"
              aria-label="删除任务"
            >
              <Trash2 class="h-4 w-4" :stroke-width="1.85" />
            </button>
          </div>
          
          <!-- Empty View -->
          <div 
            v-if="filteredTasks.length === 0" 
            class="text-center py-16 px-6 bg-surface-container-low rounded-xl border border-dashed border-outline-variant animate-entrance"
            style="animation-delay: 0.3s;"
          >
            <CheckSquare class="h-12 w-12 text-secondary/60 mx-auto mb-4" :stroke-width="1.5" />
            <h3 class="font-headline text-lg font-bold text-on-surface">暂无待办事项</h3>
            <p class="text-sm text-secondary mt-1">这里一切轻松，给自己放个假，或者添加一项任务吧！</p>
          </div>

          <!-- Asymmetric Quote Section (Always visible at the bottom of the scroll) -->
          <section class="mt-8 p-6 bg-surface-container-low rounded-2xl relative overflow-hidden animate-entrance" style="animation-delay: 0.6s;">
            <div class="relative z-10 transition-transform duration-500 hover:translate-x-1">
              <Quote class="text-primary/20 h-7 w-7 mb-1" :stroke-width="2" />
              <p class="font-headline text-on-background italic opacity-80 leading-relaxed text-sm max-w-xs">
                "专注是一种能力，更是一种通过刻意练习习得的智慧。"
              </p>
              <p class="mt-3 text-[10px] text-on-surface-variant uppercase tracking-widest font-bold font-label">— 曼修尔</p>
            </div>
            <div class="absolute right-[-20px] bottom-[-20px] w-32 h-32 bg-primary/5 rounded-full blur-3xl"></div>
          </section>

        </div>
      </div>
      
    </div>
  </div>
</template>

<style scoped>
/* Circular chart dynamic parameters */
svg {
  display: block;
}

/* 紧急任务上下无缝轮播过渡动画（旧项向上推出同时新项自下方推入，零空白断层） */
.urgent-slide-enter-active,
.urgent-slide-leave-active {
  transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.38s cubic-bezier(0.22, 1, 0.36, 1);
}

.urgent-slide-enter-from {
  opacity: 0;
  transform: translateY(100%);
}

.urgent-slide-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.urgent-slide-leave-from {
  opacity: 1;
  transform: translateY(0);
}

.urgent-slide-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}
</style>
