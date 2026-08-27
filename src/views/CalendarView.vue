<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  getLocalTimeZone,
  today,
  parseDate,
} from '@internationalized/date'
import {
  type DateValue,
} from 'reka-ui'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarX,
  CalendarPlus,
  CheckCircle2,
  Briefcase,
  Home,
  Clock,
  Calendar as CalendarIcon,
} from 'lucide-vue-next'
import { useTaskStore } from '../store/task'
import { useIsMobile } from '../composables/useIsMobile'
import { toLocalDateString } from '../shared/date'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CalendarRoot,
  CalendarGrid,
  CalendarGridHead,
  CalendarGridBody,
  CalendarGridRow,
  CalendarCell,
} from '@/components/ui/calendar'

const router = useRouter()
const taskStore = useTaskStore()
const isMobile = useIsMobile()

// 当前时区与今日日期对象
const timeZone = getLocalTimeZone()
const todayVal = today(timeZone)

// 当前选中的日期（DateValue 响应式状态）
function getInitialSelectedDate(): any {
  try {
    const todayStr = toLocalDateString()
    return parseDate(todayStr)
  } catch {
    return todayVal
  }
}

const selectedDate = ref<any>(getInitialSelectedDate())

// 占位日期（控制日历当前翻阅的年/月视图）
const placeholder = ref<any>(todayVal)

// 选中的 YYYY-MM-DD 字符串
const selectedDateStr = computed(() => {
  if (!selectedDate.value) return toLocalDateString()
  const y = selectedDate.value.year
  const m = String(selectedDate.value.month).padStart(2, '0')
  const d = String(selectedDate.value.day).padStart(2, '0')
  return `${y}-${m}-${d}`
})

// 年份与月份名称展示
const currentYear = computed(() => placeholder.value.year)
const currentMonth = computed(() => placeholder.value.month)

const monthNames = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月'
]

const currentMonthName = computed(() => monthNames[currentMonth.value - 1] || `${currentMonth.value}月`)

// 翻月控制
const prevMonth = () => {
  placeholder.value = placeholder.value.subtract({ months: 1 })
}

const nextMonth = () => {
  placeholder.value = placeholder.value.add({ months: 1 })
}

const tasksByDateMap = computed(() => taskStore.tasksByDateMap)

// 选中某一天的任务列表
const selectedDateTasks = computed(() => {
  return tasksByDateMap.value[selectedDateStr.value] ?? []
})

// 格式化当前选中日期的文字说明，如 "2026年3月24日 星期二"
const formattedSelectedDate = computed(() => {
  if (!selectedDate.value) return { fullDate: '', dayOfWeek: '' }
  const y = selectedDate.value.year
  const m = selectedDate.value.month
  const d = selectedDate.value.day
  const dateObj = new Date(y, m - 1, d)
  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return {
    fullDate: `${y}年${m}月${d}日`,
    dayOfWeek: weekDays[dateObj.getDay()]
  }
})

// 根据 dateValue 获取格式化 YYYY-MM-DD
function getDateString(date: DateValue): string {
  const y = date.year
  const m = String(date.month).padStart(2, '0')
  const d = String(date.day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 获取某天的任务列表
function getTasksForDate(date: DateValue) {
  const str = getDateString(date)
  return tasksByDateMap.value[str] || []
}

// 跳转到新增详情页
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
    <header class="calendar-safe-header bg-background/80 backdrop-blur-md flex justify-between items-center min-h-16 px-6 md:px-8 pb-4 shadow-xs flex-shrink-0 z-10 sticky top-0 border-b border-outline-variant/20">
      <div class="flex items-center gap-4">
        <h2 class="font-headline text-2xl text-primary font-bold tracking-tight">
          {{ currentYear }}年 {{ currentMonthName }}
        </h2>
        <div class="flex items-center gap-1">
          <Button 
            variant="ghost" 
            size="icon-sm"
            @click="prevMonth"
            class="rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <ChevronLeft class="h-4 w-4" :stroke-width="2" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon-sm"
            @click="nextMonth"
            class="rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <ChevronRight class="h-4 w-4" :stroke-width="2" />
          </Button>
        </div>
      </div>
      
      <div class="flex items-center gap-3">
        <Button 
          @click="goToAddEvent"
          size="sm"
          class="hidden md:inline-flex rounded-xl shadow-xs"
        >
          <Plus class="h-4 w-4" :stroke-width="2.2" />
          <span>新增日程</span>
        </Button>
      </div>
    </header>

    <!-- ==================== DESKTOP WORKSPACE (>= 768px) ==================== -->
    <div v-if="!isMobile" class="hidden md:flex flex-1 overflow-hidden p-6 md:p-8 gap-8">
      
      <!-- Calendar Large Grid (Powered by Reka UI CalendarRoot) -->
      <div class="flex-1 bg-surface-container-lowest rounded-2xl border border-outline-variant/30 flex flex-col overflow-hidden shadow-xs">
        <CalendarRoot
          v-model="selectedDate"
          v-model:placeholder="placeholder"
          :week-starts-on="0"
          locale="zh-CN"
          class="flex-1 flex flex-col p-0 w-full"
          v-slot="{ grid, weekDays }"
        >
          <!-- Day Headers -->
          <CalendarGridHead class="grid grid-cols-7 border-b border-outline-variant/30 bg-surface-container-low text-secondary font-bold text-xs text-center py-2.5 uppercase tracking-wider">
            <div v-for="day in weekDays" :key="day" class="text-center">
              {{ day }}
            </div>
          </CalendarGridHead>

          <!-- Calendar Grid Content -->
          <div class="flex-1 overflow-y-auto">
            <CalendarGrid v-for="month in grid" :key="month.value.toString()" class="h-full w-full border-collapse space-y-0">
              <CalendarGridBody class="h-full grid grid-rows-6 gap-[1px] bg-outline-variant/20">
                <CalendarGridRow
                  v-for="(weekDates, weekIndex) in month.rows"
                  :key="`row-${weekIndex}`"
                  class="grid grid-cols-7 gap-[1px] m-0 bg-transparent min-h-[90px]"
                >
                  <CalendarCell
                    v-for="weekDate in weekDates"
                    :key="weekDate.toString()"
                    :date="weekDate"
                    class="p-0 relative bg-surface-container-lowest group hover:bg-surface-container-low transition-colors duration-100 cursor-pointer"
                    @click="selectedDate = weekDate"
                  >
                    <div
                      :class="[
                        'h-full w-full p-2 flex flex-col transition-all',
                        selectedDateStr === getDateString(weekDate)
                          ? 'bg-secondary-fixed/30 ring-2 ring-inset ring-primary'
                          : ''
                      ]"
                    >
                      <div class="flex justify-between items-center mb-1">
                        <span 
                          :class="[
                            'text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full transition-colors',
                            selectedDateStr === getDateString(weekDate)
                              ? 'bg-primary text-on-primary shadow-xs'
                              : weekDate.month === month.value.month
                                ? 'text-on-surface'
                                : 'text-on-surface-variant/30'
                          ]"
                        >
                          {{ weekDate.day }}
                        </span>

                        <span
                          v-if="weekDate.toString() === todayVal.toString()"
                          class="text-[10px] text-primary font-bold px-1.5 py-0.2 bg-primary/10 rounded-md"
                        >
                          今天
                        </span>
                      </div>
                      
                      <!-- Tasks Badges inside Cell -->
                      <div class="space-y-1 mt-1 overflow-y-auto max-h-[64px] no-scrollbar">
                        <div 
                          v-for="task in getTasksForDate(weekDate)" 
                          :key="task.id"
                          :class="[
                            task.completed ? 'bg-surface-container text-outline/70 line-through' : '',
                            !task.completed && task.category === '工作' ? 'bg-primary-container text-on-primary-container border border-primary/20' : '',
                            !task.completed && task.category === '个人' ? 'bg-tertiary-container text-on-tertiary-container border border-tertiary/20' : '',
                            !task.completed && task.category !== '工作' && task.category !== '个人' ? 'bg-surface-container-high text-on-surface' : ''
                          ]"
                          class="text-[10px] rounded px-1.5 py-0.5 truncate font-semibold"
                        >
                          {{ task.title }}
                        </div>
                      </div>
                    </div>
                  </CalendarCell>
                </CalendarGridRow>
              </CalendarGridBody>
            </CalendarGrid>
          </div>
        </CalendarRoot>
      </div>

      <!-- Right Details Panel (Desktop Aside) -->
      <aside class="w-80 bg-surface-container-lowest rounded-2xl border border-outline-variant/30 flex flex-col overflow-hidden shadow-xs">
        <div class="p-6 border-b border-outline-variant/30 bg-surface-container-low">
          <h3 class="font-headline text-xl text-on-surface font-bold">{{ formattedSelectedDate.dayOfWeek }}</h3>
          <p class="text-primary font-bold text-lg">{{ formattedSelectedDate.fullDate }}</p>
        </div>
        
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <!-- Tasks list for selected day -->
          <div 
            v-for="task in selectedDateTasks" 
            :key="task.id"
            @click="editTask(task.id)"
            :class="{ 'opacity-60': task.completed }"
            class="bg-surface-container-low p-4 rounded-xl border border-outline-variant/30 hover:bg-surface-container hover:border-outline-variant transition-colors cursor-pointer group"
          >
            <div class="flex justify-between items-start mb-2">
              <Badge 
                :variant="task.category === '工作' ? 'default' : task.category === '个人' ? 'secondary' : 'outline'"
                class="text-[11px] font-bold tracking-wide"
              >
                {{ task.category }}
              </Badge>
              <span v-if="task.timeStart" class="text-[10px] text-secondary bg-surface-container-lowest px-2 py-0.5 rounded-md border border-outline-variant/30 font-bold">
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
            <CalendarX class="h-10 w-10 text-secondary/50 mx-auto mb-2" :stroke-width="1.5" />
            <p class="text-sm font-semibold text-secondary">今日无日程安排</p>
            <p class="text-xs text-secondary/70 mt-1">享受惬意时光吧，或者新建一个日程记录！</p>
          </div>
        </div>
        
        <div class="p-4 border-t border-outline-variant/30 bg-surface-container-low flex-shrink-0">
          <Button 
            variant="outline"
            @click="goToAddEvent"
            class="w-full rounded-xl py-2.5 font-bold border-primary/30 text-primary hover:bg-primary/5"
          >
            <CalendarPlus class="h-4 w-4 mr-2" :stroke-width="2" />
            <span>添加事件</span>
          </Button>
        </div>
      </aside>
    </div>

    <!-- ==================== MOBILE WORKSPACE (< 768px) ==================== -->
    <div v-else class="md:hidden flex-grow px-4 py-4 flex flex-col gap-5 overflow-y-auto">
      
      <!-- Compact Month Calendar Card -->
      <section class="flex-shrink-0 bg-surface-container-lowest rounded-2xl p-4 shadow-xs border border-outline-variant/30">
        <CalendarRoot
          v-model="selectedDate"
          v-model:placeholder="placeholder"
          :week-starts-on="0"
          locale="zh-CN"
          v-slot="{ grid, weekDays }"
          class="w-full"
        >
          <div class="grid grid-cols-7 mb-2 text-center">
            <span v-for="day in weekDays" :key="day" class="text-[11px] font-label text-secondary font-semibold uppercase">
              {{ day }}
            </span>
          </div>

          <div v-for="month in grid" :key="month.value.toString()" class="space-y-1">
            <div
              v-for="(weekDates, weekIndex) in month.rows"
              :key="`m-week-${weekIndex}`"
              class="grid grid-cols-7 gap-1 text-center text-sm font-semibold"
            >
              <div
                v-for="weekDate in weekDates"
                :key="weekDate.toString()"
                @click="selectedDate = weekDate"
                :class="[
                  'py-1.5 flex flex-col items-center justify-center aspect-square text-xs rounded-xl relative cursor-pointer transition-all',
                  weekDate.month === month.value.month ? 'text-on-surface' : 'text-on-surface-variant/30 font-normal',
                  selectedDateStr === getDateString(weekDate)
                    ? 'bg-primary text-on-primary font-bold shadow-xs scale-105'
                    : 'hover:bg-surface-container'
                ]"
              >
                <span>{{ weekDate.day }}</span>
                
                <!-- Event indicators dot -->
                <span 
                  v-if="getTasksForDate(weekDate).length > 0 && selectedDateStr !== getDateString(weekDate)" 
                  class="absolute bottom-1 w-1 h-1 rounded-full bg-primary"
                ></span>
              </div>
            </div>
          </div>
        </CalendarRoot>
      </section>

      <!-- Tasks list for selected day (Mobile) -->
      <section class="flex-1 flex flex-col min-h-[200px]">
        <div class="flex justify-between items-center mb-3 flex-shrink-0 px-1">
          <h2 class="font-headline text-base text-on-surface font-semibold">
            日程 - {{ formattedSelectedDate.fullDate }} ({{ selectedDateTasks.length }})
          </h2>
          <Button 
            variant="ghost"
            size="sm"
            @click="goToAddEvent"
            class="text-primary text-xs font-semibold h-7 px-2"
          >
            <Plus class="h-3.5 w-3.5 mr-1" :stroke-width="2.2" /> 
            <span>添加</span>
          </Button>
        </div>
        
        <div class="flex-1 flex flex-col gap-2.5 pb-6">
          <div 
            v-for="task in selectedDateTasks" 
            :key="task.id"
            @click="editTask(task.id)"
            :class="task.completed ? 'bg-surface-container-low border border-outline-variant/10 opacity-75' : 'bg-surface-container-lowest border border-outline-variant/30 shadow-xs'"
            class="rounded-xl p-3.5 flex gap-3.5 items-start cursor-pointer active:scale-[0.98] transition-transform duration-100"
          >
            <!-- Category color box icon -->
            <div 
              :class="[
                task.completed ? 'bg-surface-variant text-outline' : '',
                !task.completed && task.category === '工作' ? 'bg-primary-container/30 text-primary' : '',
                !task.completed && task.category === '个人' ? 'bg-tertiary-container/30 text-tertiary' : '',
                !task.completed && task.category !== '工作' && task.category !== '个人' ? 'bg-surface-container text-secondary' : ''
              ]"
              class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            >
              <CheckCircle2 v-if="task.completed" class="h-4 w-4" :stroke-width="2" />
              <Briefcase v-else-if="task.category === '工作'" class="h-4 w-4" :stroke-width="2" />
              <Home v-else class="h-4 w-4" :stroke-width="2" />
            </div>
            
            <div class="flex-1 min-w-0">
              <h3 
                :class="{ 'text-outline line-through': task.completed, 'text-on-surface': !task.completed }"
                class="font-semibold text-sm mb-0.5 truncate"
              >
                {{ task.title }}
              </h3>
              <p class="text-[11px] text-secondary line-clamp-1 mb-1.5">{{ task.notes || '没有详细备注说明' }}</p>
              <div 
                v-if="task.timeStart"
                :class="task.completed ? 'text-outline' : 'text-on-surface-variant'" 
                class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
              >
                <Clock class="h-3 w-3" :stroke-width="2" />
                <span>{{ task.timeStart }} {{ task.timeEnd ? '- ' + task.timeEnd : '' }}</span>
              </div>
            </div>
          </div>

          <div 
            v-if="selectedDateTasks.length === 0" 
            class="text-center py-10 px-4 bg-surface-container-low rounded-xl border border-dashed border-outline-variant"
          >
            <CalendarIcon class="h-8 w-8 text-secondary/40 mx-auto mb-2" :stroke-width="1.5" />
            <p class="text-sm font-semibold text-secondary">这一天没有日程</p>
            <p class="text-xs text-secondary/60 mt-1">给这一天写个待办，或者出去走走吧！</p>
          </div>
        </div>
      </section>

    </div>

  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.calendar-safe-header {
  padding-top: calc(0.75rem + env(safe-area-inset-top, 0px));
}
</style>
