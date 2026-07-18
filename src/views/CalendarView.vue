<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskStore } from '../store/task'
import { useIsMobile } from '../composables/useIsMobile'
import { toLocalDateString } from '../shared/date'

const router = useRouter()
const taskStore = useTaskStore()
const isMobile = useIsMobile()

// 当前日历年份与月份状态
const currentDate = ref(new Date())

// 选中的日期，默认为今天 YYYY-MM-DD
const selectedDateStr = ref(toLocalDateString())

// 年份和月份计算
const currentYear = computed(() => currentDate.value.getFullYear())
const currentMonth = computed(() => currentDate.value.getMonth()) // 0-11

const monthNames = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月'
]

const currentMonthName = computed(() => monthNames[currentMonth.value])

// 日历网格计算
const calendarDays = computed(() => {
  const year = currentYear.value
  const month = currentMonth.value

  // 获取本月第一天是星期几 (0-6)
  const firstDayIndex = new Date(year, month, 1).getDay()

  // 获取本月共有多少天
  const totalDays = new Date(year, month + 1, 0).getDate()

  // 获取上月共有多少天
  const prevTotalDays = new Date(year, month, 0).getDate()

  const daysArr = []

  // 1. 填充上个月的灰色日期
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const d = prevTotalDays - i
    const m = month === 0 ? 11 : month - 1
    const y = month === 0 ? year - 1 : year
    daysArr.push({
      day: d,
      dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      isCurrentMonth: false
    })
  }

  // 2. 填充本月日期
  for (let i = 1; i <= totalDays; i++) {
    daysArr.push({
      day: i,
      dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`,
      isCurrentMonth: true
    })
  }

  // 3. 填充下个月的灰色日期，以补齐 35 或 42 格
  const remaining = 42 - daysArr.length
  // 如果剩余格子大于 7，可以只填 35 格，但通常补满 42 格最规整
  for (let i = 1; i <= remaining; i++) {
    const m = month === 11 ? 0 : month + 1
    const y = month === 11 ? year + 1 : year
    daysArr.push({
      day: i,
      dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`,
      isCurrentMonth: false
    })
  }

  return daysArr
})

const tasksByDateMap = computed(() => taskStore.tasksByDateMap)

const calendarDaysWithTasks = computed(() => {
  return calendarDays.value.map((day) => ({
    ...day,
    tasks: tasksByDateMap.value[day.dateStr] ?? []
  }))
})

// 月份切换
const prevMonth = () => {
  currentDate.value = new Date(currentYear.value, currentMonth.value - 1, 1)
}

const nextMonth = () => {
  currentDate.value = new Date(currentYear.value, currentMonth.value + 1, 1)
}

// 选中某一天的任务列表
const selectedDateTasks = computed(() => {
  return getTasksForDate(selectedDateStr.value)
})

// 获取特定日期的任务
const getTasksForDate = (dateStr: string) => {
  return tasksByDateMap.value[dateStr] ?? []
}

// 选中天数的中文格式化
const formattedSelectedDate = computed(() => {
  const [y, m, d] = selectedDateStr.value.split('-')
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d))
  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return {
    dayOfWeek: weekDays[dateObj.getDay()],
    fullDate: `${monthNames[dateObj.getMonth()]} ${d}日`
  }
})

// 选择日期
const selectDate = (dateStr: string) => {
  selectedDateStr.value = dateStr
}

// 跳转到新增详情页，并携带日期参数
const goToAddEvent = () => {
  router.push({
    path: '/task-details',
    query: { date: selectedDateStr.value }
  })
}

// 跳转到编辑
const editTask = (id: string) => {
  router.push(`/task-details/${id}`)
}
</script>

<template>
  <div class="flex-grow flex flex-col h-full bg-background relative overflow-hidden">
    
    <!-- ==================== TOP NAVIGATION HEADER ==================== -->
    <header class="calendar-safe-header bg-background/80 dark:bg-background/80 backdrop-blur-md flex justify-between items-center min-h-16 px-6 md:px-8 pb-4 shadow-sm flex-shrink-0 z-10 sticky top-0">
      <div class="flex items-center gap-4">
        <h2 class="font-headline text-2xl text-primary dark:text-primary-fixed-dim font-bold">
          {{ currentYear }}年 {{ currentMonthName }}
        </h2>
        <div class="flex items-center gap-2">
          <button 
            @click="prevMonth"
            class="p-2 text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-all flex items-center justify-center"
          >
            <span class="material-symbols-outlined">chevron_left</span>
          </button>
          <button 
            @click="nextMonth"
            class="p-2 text-on-surface-variant hover:bg-surface-container-highest rounded-full transition-all flex items-center justify-center"
          >
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
      </div>
      
      <div class="flex items-center gap-4">
        <button 
          @click="goToAddEvent"
          class="bg-primary text-on-primary md:flex hidden items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold shadow-sm hover:opacity-95 transition-all"
        >
          <span class="material-symbols-outlined text-sm">add</span>
          新增日程
        </button>
      </div>
    </header>

    <!-- ==================== DESKTOP WORKSPACE (>= 768px) ==================== -->
    <div v-if="!isMobile" class="hidden md:flex flex-1 overflow-hidden p-6 md:p-8 gap-8">
      
      <!-- Calendar Large Grid -->
      <div class="flex-1 bg-surface-bright rounded-xl border border-outline-variant/30 flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(46,50,48,0.06)]">
        <!-- Day Headers -->
        <div class="grid grid-cols-7 border-b border-outline-variant/30 bg-surface-container-low text-secondary font-bold text-sm text-center py-3 uppercase tracking-wider">
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>
        <!-- Grid Cells -->
        <div class="flex-1 grid grid-cols-7 grid-rows-6 bg-outline-variant/20 gap-[1px]">
          <div 
            v-for="item in calendarDaysWithTasks" 
            :key="item.dateStr"
            @click="selectDate(item.dateStr)"
            :class="[
              item.isCurrentMonth ? 'bg-surface-bright' : 'bg-surface-bright/40 opacity-50',
              selectedDateStr === item.dateStr ? 'bg-secondary-fixed/50 ring-2 ring-primary relative z-10' : ''
            ]"
            class="p-2 flex flex-col cursor-pointer transition-colors duration-150 relative group"
          >
            <div class="flex justify-between items-center mb-1">
              <span 
                :class="selectedDateStr === item.dateStr ? 'bg-primary text-on-primary w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shadow-sm' : 'text-on-surface-variant font-bold text-sm'"
              >
                {{ item.day }}
              </span>
            </div>
            
            <!-- Tasks Badges -->
            <div class="space-y-1 mt-1 overflow-y-auto max-h-[70px] no-scrollbar">
              <div 
                v-for="task in item.tasks" 
                :key="task.id"
                :class="[
                  task.completed ? 'bg-surface-container text-outline/80 line-through' : '',
                  !task.completed && task.category === '工作' ? 'bg-primary-container text-on-primary-container border border-primary/20' : '',
                  !task.completed && task.category === '个人' ? 'bg-tertiary-container text-on-tertiary-container border border-tertiary/20' : '',
                  !task.completed && task.category !== '工作' && task.category !== '个人' ? 'bg-surface-container text-on-surface' : ''
                ]"
                class="text-[10px] rounded px-1.5 py-0.5 truncate transition-all font-semibold"
              >
                {{ task.title }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Details Panel (Desktop Aside) -->
      <aside class="w-80 bg-surface-container-lowest rounded-xl border border-outline-variant/30 flex flex-col overflow-hidden shadow-[0_4px_20px_rgba(46,50,48,0.06)]">
        <div class="p-6 border-b border-outline-variant/30 bg-surface-bright">
          <h3 class="font-headline text-xl text-on-surface font-bold">{{ formattedSelectedDate.dayOfWeek }}</h3>
          <p class="text-primary font-bold text-lg">{{ formattedSelectedDate.fullDate }}</p>
        </div>
        
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <!-- Tasks list for selected day -->
          <div 
            v-for="task in selectedDateTasks" 
            :key="task.id"
            @click="editTask(task.id)"
            :class="{ 'opacity-60': task.completed }"
            class="bg-surface-container p-4 rounded-xl border border-outline-variant/20 hover:bg-surface-container-high transition-colors cursor-pointer group"
          >
            <div class="flex justify-between items-start mb-2">
              <span 
                :class="[
                  task.category === '工作' ? 'text-primary' : '',
                  task.category === '个人' ? 'text-tertiary' : 'text-secondary'
                ]"
                class="text-xs font-bold uppercase tracking-wide"
              >
                {{ task.category }}
              </span>
              <span v-if="task.timeStart" class="text-[10px] text-secondary bg-surface-bright px-2 py-0.5 rounded-md border border-outline-variant/20 font-bold">
                {{ task.timeStart }}
              </span>
            </div>
            <h4 
              :class="{ 'line-through': task.completed }"
              class="font-bold text-on-surface text-sm mb-1 group-hover:text-primary transition-colors truncate"
            >
              {{ task.title }}
            </h4>
            <p class="text-[11px] text-on-surface-variant line-clamp-2 leading-relaxed">{{ task.notes || '没有备注说明' }}</p>
          </div>
          
          <div v-if="selectedDateTasks.length === 0" class="text-center py-16 px-4">
            <span class="material-symbols-outlined text-4xl text-secondary mb-2">event_busy</span>
            <p class="text-sm font-semibold text-secondary">今日无日程安排</p>
            <p class="text-xs text-secondary/70 mt-1">享受惬意时光吧，或者新建一个日程记录！</p>
          </div>
        </div>
        
        <div class="p-4 border-t border-outline-variant/30 bg-surface-bright flex-shrink-0">
          <button 
            @click="goToAddEvent"
            class="w-full bg-surface-bright text-primary border border-primary/30 rounded-xl py-2.5 px-4 font-bold flex items-center justify-center gap-2 hover:bg-primary-container hover:border-primary transition-colors duration-200"
          >
            <span class="material-symbols-outlined text-sm">edit_calendar</span>
            添加事件
          </button>
        </div>
      </aside>
    </div>

    <!-- ==================== MOBILE WORKSPACE (< 768px) ==================== -->
    <div v-else class="md:hidden flex-grow px-6 py-4 flex flex-col gap-6">
      
      <!-- Compact Month Calendar Card -->
      <section class="flex-shrink-0">
        <div class="bg-surface-bright rounded-2xl p-5 shadow-[0_4px_20px_rgba(46,50,48,0.04)] border border-outline-variant/20">
          <!-- Week Headers -->
          <div class="grid grid-cols-7 mb-4 text-center">
            <span class="text-xs font-label text-secondary font-semibold uppercase tracking-wider">S</span>
            <span class="text-xs font-label text-secondary font-semibold uppercase tracking-wider">M</span>
            <span class="text-xs font-label text-secondary font-semibold uppercase tracking-wider">T</span>
            <span class="text-xs font-label text-secondary font-semibold uppercase tracking-wider">W</span>
            <span class="text-xs font-label text-secondary font-semibold uppercase tracking-wider">T</span>
            <span class="text-xs font-label text-secondary font-semibold uppercase tracking-wider">F</span>
            <span class="text-xs font-label text-secondary font-semibold uppercase tracking-wider">S</span>
          </div>
          <!-- Days Grid -->
          <div class="grid grid-cols-7 gap-y-3 gap-x-1 text-center text-sm font-semibold">
            <div 
              v-for="item in calendarDaysWithTasks" 
              :key="item.dateStr"
              @click="selectDate(item.dateStr)"
              :class="[
                item.isCurrentMonth ? 'text-on-surface' : 'text-on-surface-variant/40 font-normal',
                selectedDateStr === item.dateStr ? 'bg-primary text-on-primary rounded-full shadow-sm relative font-bold cursor-pointer scale-105' : 'rounded-full hover:bg-surface-container transition-colors cursor-pointer'
              ]"
              class="py-2 flex items-center justify-center aspect-square text-xs relative"
            >
              {{ item.day }}
              
              <!-- Event indicators (small dot under day text) -->
              <span 
                v-if="item.tasks.length > 0 && selectedDateStr !== item.dateStr" 
                class="absolute bottom-1 w-1 h-1 rounded-full"
                :class="item.tasks[0]?.category === '工作' ? 'bg-primary' : 'bg-tertiary'"
              ></span>
            </div>
          </div>
        </div>
      </section>

      <!-- Tasks list for selected day (Mobile) -->
      <section class="flex-1 flex flex-col overflow-hidden min-h-[200px]">
        <div class="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 class="font-headline text-lg text-on-surface font-semibold">
            日程 - {{ formattedSelectedDate.fullDate }} ({{ selectedDateTasks.length }})
          </h2>
          <button 
            @click="goToAddEvent"
            class="text-primary text-sm font-semibold hover:text-primary-fixed-dim transition-colors flex items-center gap-1"
          >
            <span class="material-symbols-outlined text-sm">add</span> 
            添加
          </button>
        </div>
        
        <div class="flex-1 overflow-y-auto flex flex-col gap-3 pb-6">
          <div 
            v-for="task in selectedDateTasks" 
            :key="task.id"
            @click="editTask(task.id)"
            :class="task.completed ? 'bg-surface-container-low border border-outline-variant/10 opacity-75' : 'bg-surface-bright border border-outline-variant/20 shadow-[0_4px_20px_rgba(46,50,48,0.04)]'"
            class="rounded-2xl p-4 flex gap-4 items-start cursor-pointer active:scale-[0.98] transition-transform duration-100"
          >
            <!-- Category color box icon -->
            <div 
              :class="[
                task.completed ? 'bg-surface-variant text-outline' : '',
                !task.completed && task.category === '工作' ? 'bg-primary-container/30 text-primary' : '',
                !task.completed && task.category === '个人' ? 'bg-tertiary-container/30 text-tertiary' : '',
                !task.completed && task.category !== '工作' && task.category !== '个人' ? 'bg-surface-container text-secondary' : ''
              ]"
              class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            >
              <span class="material-symbols-outlined">
                {{ task.completed ? 'check_circle' : (task.category === '工作' ? 'work' : 'home') }}
              </span>
            </div>
            
            <div class="flex-1 min-w-0">
              <h3 
                :class="{ 'text-outline line-through': task.completed, 'text-on-surface': !task.completed }"
                class="font-semibold text-base mb-1 truncate"
              >
                {{ task.title }}
              </h3>
              <p class="text-xs text-secondary line-clamp-1 mb-2">{{ task.notes || '没有详细备注说明' }}</p>
              <div 
                v-if="task.timeStart"
                :class="task.completed ? 'text-outline' : 'text-on-surface-variant'" 
                class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider"
              >
                <span class="material-symbols-outlined text-[14px]">schedule</span>
                {{ task.timeStart }} {{ task.timeEnd ? '- ' + task.timeEnd : '' }}
              </div>
            </div>
          </div>

          <div 
            v-if="selectedDateTasks.length === 0" 
            class="text-center py-12 px-4 bg-surface-container-low rounded-xl border border-dashed border-outline-variant"
          >
            <span class="material-symbols-outlined text-4xl text-secondary mb-2">calendar_today</span>
            <p class="text-sm font-semibold text-secondary">这一天没有日程</p>
            <p class="text-xs text-secondary/70 mt-1">给这一天写个待办，或者出去走走吧！</p>
          </div>
        </div>
      </section>

    </div>

  </div>
</template>

<style scoped>
/* Circular chart helper */
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.calendar-safe-header {
  padding-top: calc(1rem + env(safe-area-inset-top, 0px));
}
</style>

