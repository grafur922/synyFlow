<script setup lang="ts">
import { ref, computed, onMounted, markRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  Trash2,
  Briefcase,
  Home,
  GraduationCap,
  Folder,
  Plus,
  Calendar,
  Sparkles
} from 'lucide-vue-next'
import { useTaskStore } from '../store/task'

const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()

// 任务 ID
const taskId = computed(() => route.params.id as string | undefined)
const isEditMode = computed(() => !!taskId.value)

// 表单响应式数据
const title = ref('')
const selectedCategory = ref('工作')
const selectedDate = ref('')
const timeStart = ref('')
const timeEnd = ref('')
const selectedPriority = ref<'Low' | 'Medium' | 'High'>('Medium')
const notes = ref('')

const categoryIconMap: Record<string, any> = {
  '工作': markRaw(Briefcase),
  '个人': markRaw(Home),
  '学习': markRaw(GraduationCap)
}

function getCategoryIcon(name: string) {
  return categoryIconMap[name] || markRaw(Folder)
}

// 自定义分类列表
const categories = ref([
  { name: '工作' },
  { name: '个人' },
  { name: '学习' }
])

// 初始化表单数据
onMounted(() => {
  // 如果是编辑模式，读取现有任务数据
  if (isEditMode.value) {
    const task = taskStore.tasks.find(t => t.id === taskId.value)
    if (task) {
      title.value = task.title
      selectedCategory.value = task.category
      selectedDate.value = task.date
      timeStart.value = task.timeStart || ''
      timeEnd.value = task.timeEnd || ''
      selectedPriority.value = task.priority
      notes.value = task.notes
      
      // 如果现有任务的分类不在预设中，加入自定义分类
      if (!categories.value.some(c => c.name === task.category)) {
        categories.value.push({ name: task.category })
      }
    } else {
      // 找不到任务，退回
      router.replace('/todo')
    }
  } else {
    // 新增模式，默认日期为今天
    const today = new Date()
    selectedDate.value = formatDateString(today)
  }
})

// 格式化日期为 YYYY-MM-DD
function formatDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 格式化月份显示 (例如：2026年5月)
const currentMonthLabel = computed(() => {
  if (!selectedDate.value) return ''
  const parts = selectedDate.value.split('-')
  if (parts.length < 2) return ''
  return `${parts[0]}年 ${parseInt(parts[1], 10)}月`
})

// 生成当前选中日期前后的 5 天滑动列表
const dateSliderDays = computed(() => {
  if (!selectedDate.value) return []
  const current = new Date(selectedDate.value)
  const days = []
  
  // 渲染选中日期周围的前2天，当天，后2天
  for (let i = -2; i <= 2; i++) {
    const d = new Date(current)
    d.setDate(current.getDate() + i)
    
    // 星期英文简写
    const weekdayName = d.toLocaleDateString('zh-CN', { weekday: 'short' })
    const dayNum = d.getDate()
    const fullDate = formatDateString(d)
    
    days.push({
      weekday: weekdayName,
      dayNumber: dayNum,
      fullDate: fullDate,
      isToday: fullDate === formatDateString(new Date())
    })
  }
  return days
})

// 选择滑块日期
const selectSliderDate = (dateStr: string) => {
  selectedDate.value = dateStr
}

// 新建分类弹窗控制
const showNewCategoryPrompt = () => {
  const newCat = prompt('请输入新分类名称：')
  if (newCat && newCat.trim()) {
    const trimmed = newCat.trim()
    if (!categories.value.some(c => c.name === trimmed)) {
      categories.value.push({ name: trimmed })
    }
    selectedCategory.value = trimmed
  }
}

// 保存表单
const saveTask = () => {
  if (!title.value.trim()) {
    alert('请输入任务名称')
    return
  }

  const taskData = {
    title: title.value.trim(),
    category: selectedCategory.value,
    date: selectedDate.value,
    timeStart: timeStart.value || undefined,
    timeEnd: timeEnd.value || undefined,
    priority: selectedPriority.value,
    notes: notes.value,
    completed: isEditMode.value 
      ? (taskStore.tasks.find(t => t.id === taskId.value)?.completed ?? false)
      : false
  }

  if (isEditMode.value && taskId.value) {
    taskStore.updateTask(taskId.value, taskData)
  } else {
    taskStore.addTask(taskData)
  }

  // 返回上一页
  router.back()
}

// 删除任务
const deleteTask = () => {
  if (confirm('确定要删除这个任务吗？此操作无法撤销。')) {
    if (taskId.value) {
      taskStore.deleteTask(taskId.value)
      router.replace('/todo')
    }
  }
}

// 返回
const goBack = () => {
  router.back()
}
</script>

<template>
  <div class="w-full h-full overflow-y-auto bg-background text-on-background flex flex-col relative">
    <!-- Header Navigation Bar -->
    <header class="mobile-safe-header w-full sticky top-0 z-50 bg-background/90 backdrop-blur-md flex items-center justify-between px-6 pb-4 border-b border-outline-variant/10">
      <button 
        @click="goBack" 
        class="p-2 rounded-full hover:bg-surface-container-high transition-colors active:scale-95 duration-200 text-on-surface-variant flex items-center justify-center"
        aria-label="返回"
      >
        <ArrowLeft class="h-4.5 w-4.5" :stroke-width="2" />
      </button>
      
      <h1 class="font-headline text-lg font-bold text-on-background">
        {{ isEditMode ? '任务详情' : '创建待办' }}
      </h1>
      
      <!-- Delete button in edit mode -->
      <button 
        v-if="isEditMode"
        @click="deleteTask"
        class="p-2 rounded-full hover:bg-error-container/20 text-error hover:text-error transition-colors active:scale-95 duration-200 flex items-center justify-center"
        title="删除任务"
        aria-label="删除任务"
      >
        <Trash2 class="h-4.5 w-4.5" :stroke-width="1.85" />
      </button>
      <div v-else class="w-9"></div> <!-- Placeholder to keep title centered -->
    </header>

    <main class="flex-grow px-6 pt-6 flex flex-col gap-6 max-w-lg mx-auto w-full">
      
      <!-- Task Title Input -->
      <section class="flex flex-col gap-2 animate-entrance" style="animation-delay: 0.04s;">
        <input 
          v-model="title"
          class="w-full bg-transparent border-none text-2xl font-headline font-bold text-on-background placeholder:text-outline/40 p-0 focus:ring-0 leading-tight border-b border-transparent focus:border-outline-variant/30 transition-all duration-300 pb-2" 
          placeholder="待办事项标题..." 
          type="text"
          autofocus
        />
      </section>

      <!-- Category Picker -->
      <section class="flex flex-col gap-3 animate-entrance" style="animation-delay: 0.08s;">
        <h2 class="font-label text-xs font-bold tracking-wider text-on-surface-variant uppercase">分类 (Category)</h2>
        <div class="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <button 
            v-for="cat in categories" 
            :key="cat.name"
            type="button"
            @click="selectedCategory = cat.name"
            :class="selectedCategory === cat.name 
              ? 'bg-primary-container text-on-primary-container font-bold border-transparent shadow-xs' 
              : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:bg-surface-container-high'"
            class="flex-none px-4 py-2 rounded-xl text-xs border transition-all duration-200 active:scale-95 flex items-center gap-1.5"
          >
            <component
              :is="getCategoryIcon(cat.name)"
              class="h-3.5 w-3.5 flex-shrink-0"
              :stroke-width="selectedCategory === cat.name ? 2.25 : 1.85"
            />
            <span>{{ cat.name }}</span>
          </button>
          
          <!-- Add custom category -->
          <button 
            type="button"
            @click="showNewCategoryPrompt"
            class="flex-none px-3 py-2 rounded-xl bg-surface-container text-on-surface-variant/50 border border-dashed border-outline-variant/50 hover:bg-surface-container-high transition-all duration-200 active:scale-95 flex items-center justify-center"
            title="添加新分类"
            aria-label="添加新分类"
          >
            <Plus class="h-3.5 w-3.5" :stroke-width="2" />
          </button>
        </div>
      </section>

      <!-- Date Week Picker Slider -->
      <section class="flex flex-col gap-3 animate-entrance" style="animation-delay: 0.12s;">
        <div class="flex justify-between items-center">
          <h2 class="font-label text-xs font-bold tracking-wider text-on-surface-variant uppercase">计划日期</h2>
          <div class="flex items-center gap-2">
            <span class="text-xs text-primary font-bold">{{ currentMonthLabel }}</span>
            <label class="cursor-pointer flex items-center justify-center p-1.5 rounded-full hover:bg-surface-container-high text-primary" title="选择日期">
              <Calendar class="h-4 w-4" :stroke-width="2" />
              <input 
                type="date" 
                v-model="selectedDate" 
                class="sr-only"
              />
            </label>
          </div>
        </div>
        
        <!-- Day Selectors -->
        <div class="flex justify-between items-center bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 shadow-[0_4px_20px_rgba(46,50,48,0.02)]">
          <button 
            v-for="day in dateSliderDays" 
            :key="day.fullDate"
            type="button"
            @click="selectSliderDate(day.fullDate)"
            class="flex-1 flex flex-col items-center relative transition-all duration-300"
            :class="selectedDate === day.fullDate ? '' : 'opacity-40 hover:opacity-75'"
          >
            <span 
              :class="selectedDate === day.fullDate ? 'text-primary font-bold' : 'text-on-surface-variant'"
              class="text-[10px] font-semibold mb-1"
            >
              {{ day.weekday.toUpperCase() }}
            </span>
            
            <div 
              v-if="selectedDate === day.fullDate"
              class="w-10 h-10 flex items-center justify-center bg-primary text-on-primary rounded-full font-bold shadow-lg shadow-primary/20 transition-all duration-300"
            >
              {{ day.dayNumber }}
            </div>
            <span 
              v-else
              class="text-base font-medium flex items-center justify-center w-10 h-10"
            >
              {{ day.dayNumber }}
            </span>

            <div v-if="selectedDate === day.fullDate" class="absolute -bottom-1.5 w-1 h-1 bg-primary rounded-full"></div>
          </button>
        </div>
      </section>

      <!-- Optional Time Period Selector -->
      <section class="flex flex-col gap-3 animate-entrance" style="animation-delay: 0.16s;">
        <h2 class="font-label text-xs font-bold tracking-wider text-on-surface-variant uppercase">具体时间 (可选)</h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1">
            <label class="text-[10px] text-on-surface-variant pl-1">开始时间</label>
            <input 
              type="time" 
              v-model="timeStart"
              class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 font-body text-sm text-on-background focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm outline-none"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-[10px] text-on-surface-variant pl-1">结束时间</label>
            <input 
              type="time" 
              v-model="timeEnd"
              class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 font-body text-sm text-on-background focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm outline-none"
            />
          </div>
        </div>
      </section>

      <!-- Priority sliding selector -->
      <section class="flex flex-col gap-3 animate-entrance" style="animation-delay: 0.20s;">
        <h2 class="font-label text-xs font-bold tracking-wider text-on-surface-variant uppercase">优先级</h2>
        <div class="relative flex bg-surface-container p-1 rounded-xl border border-outline-variant/20 overflow-hidden">
          <!-- Sliding Background Block -->
          <div 
            :style="{ transform: `translateX(${selectedPriority === 'Low' ? '0' : selectedPriority === 'Medium' ? '100' : '200'}%)` }"
            class="absolute top-1 left-1 w-[calc(33.333%-4px)] h-[calc(100%-8px)] bg-surface-container-lowest rounded-lg shadow-sm transition-transform duration-300 z-0"
          ></div>
          
          <button 
            type="button"
            @click="selectedPriority = 'Low'"
            :class="selectedPriority === 'Low' ? 'text-primary font-bold' : 'text-on-surface-variant'"
            class="flex-1 py-2 text-xs font-semibold rounded-lg relative z-10 transition-colors duration-300"
          >
            Low
          </button>
          <button 
            type="button"
            @click="selectedPriority = 'Medium'"
            :class="selectedPriority === 'Medium' ? 'text-primary font-bold' : 'text-on-surface-variant'"
            class="flex-1 py-2 text-xs font-semibold rounded-lg relative z-10 transition-colors duration-300"
          >
            Medium
          </button>
          <button 
            type="button"
            @click="selectedPriority = 'High'"
            :class="selectedPriority === 'High' ? 'text-primary font-bold' : 'text-on-surface-variant'"
            class="flex-1 py-2 text-xs font-semibold rounded-lg relative z-10 transition-colors duration-300"
          >
            High
          </button>
        </div>
      </section>

      <!-- Notes/Details Description Area -->
      <section class="flex flex-col gap-3 flex-grow pb-4 animate-entrance" style="animation-delay: 0.24s;">
        <h2 class="font-label text-xs font-bold tracking-wider text-on-surface-variant uppercase">备注说明</h2>
        <textarea 
          v-model="notes"
          class="w-full flex-grow min-h-[120px] bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 font-body text-base text-on-background placeholder:text-outline/30 focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none shadow-[0_4px_20px_rgba(46,50,48,0.02)] outline-none" 
          placeholder="添加关于任务的详情或步骤..."
        ></textarea>
      </section>

      <!-- Offline friendly Contextual Visual -->
      <section class="mb-4 opacity-80 animate-entrance" style="animation-delay: 0.28s;">
        <div class="w-full h-32 rounded-xl overflow-hidden border border-outline-variant/20 relative">
          <div class="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent"></div>
          <div class="w-full h-full bg-primary/5 flex flex-col items-center justify-center text-primary/50 gap-2">
            <Sparkles class="h-7 w-7" :stroke-width="1.75" />
            <span class="text-[10px] uppercase font-bold tracking-widest">Focus & Core</span>
          </div>
        </div>
      </section>

    </main>

    <!-- Floating Save Button at the Bottom of Workspace -->
    <div class="mobile-safe-bottom sticky bottom-0 z-40 w-full bg-gradient-to-t from-background via-background/95 to-transparent pt-6 px-6 pointer-events-none mt-auto">
      <div class="max-w-lg mx-auto w-full pointer-events-auto pb-4 flex justify-center">
        <button 
          @click="saveTask"
          class="w-60 max-w-full bg-primary text-on-primary py-3.5 rounded-full font-label text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/95 transition-all duration-200 active:scale-95"
        >
          {{ isEditMode ? '保存修改' : '保存任务' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Hide Native Datepicker text but keep triggerable area active */
input[type="date"]::-webkit-calendar-picker-indicator {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: auto;
  height: auto;
  color: transparent;
  background: transparent;
  cursor: pointer;
}

.mobile-safe-header {
  padding-top: calc(1rem + env(safe-area-inset-top, 0px));
}

.mobile-safe-bottom {
  padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
