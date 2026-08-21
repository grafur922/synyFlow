<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskStore } from '../store/task'
import { useIsMobile } from '../composables/useIsMobile'
import { toLocalDateString } from '../shared/date'

const router = useRouter()
const taskStore = useTaskStore()
const isMobile = useIsMobile()

// 本地分类选择状态 (移动端)
const selectedCategory = ref('全部')

// 搜索框输入状态
const searchQuery = ref('')



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
    <header v-if="!isMobile" class="hidden md:flex justify-between items-center h-16 px-8 bg-background/80 backdrop-blur-md shadow-sm z-10 sticky top-0 flex-shrink-0">
      <div class="flex items-center gap-4">
        <h2 class="font-headline text-2xl font-bold text-primary dark:text-primary-fixed-dim">待办工作台</h2>
      </div>
      
      <div class="flex-1 max-w-md mx-8">
        <div class="relative focus-within:ring-2 focus-within:ring-primary/50 transition-all rounded-full bg-surface-container-highest flex items-center px-4 py-2 border border-outline-variant/20">
          <span class="material-symbols-outlined text-on-surface-variant mr-2">search</span>
          <input 
            v-model="searchQuery"
            class="bg-transparent border-none outline-none text-on-surface w-full placeholder:text-on-surface-variant text-sm font-body focus:ring-0 focus:outline-none" 
            placeholder="搜索待办、分类或备注..."
            type="text"
          />
        </div>
      </div>
      
      <div class="flex items-center gap-4">
        <button class="text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-all p-2">
          <span class="material-symbols-outlined">notifications</span>
        </button>
        <button class="text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-all p-2">
          <span class="material-symbols-outlined">help_outline</span>
        </button>
      </div>
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
            <div class="mb-4 flex w-full items-center gap-2.5 self-stretch">
              <span class="inline-flex h-8 w-8 flex-shrink-0 aspect-square items-center justify-center rounded-lg bg-primary-container text-primary"><span class="material-symbols-outlined text-[20px]">pie_chart</span></span>
              <h3 class="font-body text-secondary text-sm font-semibold leading-8 tracking-wide">本周完成率</h3>
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
                <span class="material-symbols-outlined text-tertiary mb-2">hourglass_top</span>
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
            <div class="flex items-center gap-2 mb-6 z-10">
              <span class="material-symbols-outlined">warning</span>
              <h3 class="font-body text-on-primary/80 text-sm font-semibold tracking-wide">需要关注</h3>
            </div>
            <div class="mb-4 z-10">
              <span class="font-headline text-5xl font-bold">{{ taskStore.urgentTasks.length }}</span>
              <p class="text-on-primary/80 mt-1">项紧急任务待处理</p>
            </div>
            <div class="mt-auto z-10 space-y-3">
              <div 
                v-if="taskStore.urgentTasks.length > 0"
                @click="navigateToDetails(taskStore.urgentTasks[0].id)"
                class="bg-on-primary-fixed-variant/40 rounded-lg p-3 backdrop-blur-sm flex justify-between items-center cursor-pointer hover:bg-on-primary-fixed-variant/60 transition-colors"
              >
                <span class="text-sm font-semibold truncate pr-2">{{ taskStore.urgentTasks[0].title }}</span>
                <span class="material-symbols-outlined text-sm">arrow_forward</span>
              </div>
              <div v-else class="text-xs text-on-primary/70 italic py-2">
                暂无高优先级紧急任务，做得很棒！
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
              查看日程 <span class="material-symbols-outlined text-sm">chevron_right</span>
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
                class="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full cursor-pointer transition-colors duration-200"
                :class="task.completed ? 'bg-primary-container/20 text-primary' : 'bg-surface-container-high text-secondary hover:bg-primary/10 hover:text-primary'"
              >
                <span class="material-symbols-outlined" :class="{ 'filled': task.completed }">
                  {{ task.completed ? 'check_circle' : 'circle' }}
                </span>
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
                    <span class="material-symbols-outlined text-[14px]">schedule</span> 
                    {{ task.timeStart }} {{ task.timeEnd ? '- ' + task.timeEnd : '' }}
                  </span>
                  <span 
                    v-if="task.priority === 'High'"
                    class="bg-error-container text-on-error-container text-[9px] px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wide"
                  >
                    紧急
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
                >
                  <span class="material-symbols-outlined text-lg">delete</span>
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
                class="checkbox-ring w-6 h-6 rounded-full border-2 flex items-center justify-center"
              >
                <span 
                  :class="task.completed ? 'opacity-100 scale-100' : 'opacity-0 scale-75'"
                  class="material-symbols-outlined text-on-primary text-[14px] check-icon transition-all duration-300"
                >check</span>
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
                  <span class="material-symbols-outlined text-[14px]">schedule</span>
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
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
          
          <!-- Empty View -->
          <div 
            v-if="filteredTasks.length === 0" 
            class="text-center py-16 px-6 bg-surface-container-low rounded-xl border border-dashed border-outline-variant animate-entrance"
            style="animation-delay: 0.3s;"
          >
            <span class="material-symbols-outlined text-5xl text-secondary mb-4">checklist</span>
            <h3 class="font-headline text-lg font-bold text-on-surface">暂无待办事项</h3>
            <p class="text-sm text-secondary mt-1">这里一切轻松，给自己放个假，或者添加一项任务吧！</p>
          </div>

          <!-- Asymmetric Quote Section (Always visible at the bottom of the scroll) -->
          <section class="mt-8 p-6 bg-surface-container-low rounded-2xl relative overflow-hidden animate-entrance" style="animation-delay: 0.6s;">
            <div class="relative z-10 transition-transform duration-500 hover:translate-x-1">
              <span class="material-symbols-outlined text-primary/20 text-3xl mb-1">format_quote</span>
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
</style>

