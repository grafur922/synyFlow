import { defineStore } from 'pinia'
import { subscribeToTaskEvents, taskApi } from '../services/taskApi'
import type { CreateTaskInput, Task, UpdateTaskInput } from '../shared/task'

export type { Task } from '../shared/task'

const storageKey = 'terra_tasks'

let taskEventSource: EventSource | undefined
let backendReconnectTimer: number | undefined

type TaskIndex = {
  byDate: Record<string, Task[]>
  completedTasks: Task[]
  pendingTasks: Task[]
  urgentTasks: Task[]
  completionRate: number
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createMockTasks(): Task[] {
  const today = getLocalDateString()

  return [
    {
      id: 'mock-1',
      title: '完成Q3产品设计评审文档',
      category: '工作',
      date: today,
      timeStart: '10:00',
      timeEnd: '11:30',
      priority: 'High',
      notes: '详细梳理组件库、间距规范以及移动端/桌面端的自适应标注，并提交评审。',
      completed: false
    },
    {
      id: 'mock-2',
      title: '取干洗衣服',
      category: '个人',
      date: today,
      timeStart: '18:00',
      timeEnd: '',
      priority: 'Medium',
      notes: '晚上回家路过干洗店时，记得凭干洗单取回风衣。',
      completed: false
    },
    {
      id: 'mock-3',
      title: '团队周会同步进度',
      category: '工作',
      date: today,
      timeStart: '09:00',
      timeEnd: '10:00',
      priority: 'Low',
      notes: '准时参加周会，向团队汇报本周 Terra 设计规范落地进度。',
      completed: true
    },
    {
      id: 'mock-4',
      title: '完成 Terra 设计系统变量',
      category: '工作',
      date: today,
      timeStart: '10:00',
      timeEnd: '11:30',
      priority: 'High',
      notes: '与开发团队确认深色模式配色映射和结构化变量配置。',
      completed: false
    },
    {
      id: 'mock-5',
      title: '晨间花园散步',
      category: '个人',
      date: today,
      timeStart: '08:00',
      timeEnd: '09:00',
      priority: 'Low',
      notes: '检查花床土壤湿度，并修剪玫瑰植株上的枯叶。',
      completed: false
    },
    {
      id: 'mock-6',
      title: '查看种子目录',
      category: '学习',
      date: today,
      timeStart: '10:30',
      timeEnd: '',
      priority: 'Medium',
      notes: '确认冬季种植采购清单，并挑选适合的有机香草种子。',
      completed: true
    },
    {
      id: 'mock-7',
      title: '审阅第四季度董事会材料',
      category: '工作',
      date: today,
      timeStart: '14:00',
      timeEnd: '15:30',
      priority: 'High',
      notes: '核对下一季度业务增长预期与市场推广策略。',
      completed: false
    }
  ]
}

export const useTaskStore = defineStore('task', {
  state: () => ({
    tasks: [] as Task[],
    loading: false,
    backendConfigured: taskApi.isConfigured,
    backendOnline: false
  }),
  getters: {
    taskIndex: (state): TaskIndex => {
      const byDate: Record<string, Task[]> = {}
      const completedTasks: Task[] = []
      const pendingTasks: Task[] = []
      const urgentTasks: Task[] = []

      for (const task of state.tasks) {
        if (!byDate[task.date]) {
          byDate[task.date] = []
        }
        byDate[task.date].push(task)

        if (task.completed) {
          completedTasks.push(task)
        } else {
          pendingTasks.push(task)

          if (task.priority === 'High') {
            urgentTasks.push(task)
          }
        }
      }

      return {
        byDate,
        completedTasks,
        pendingTasks,
        urgentTasks,
        completionRate: state.tasks.length === 0
          ? 0
          : Math.round((completedTasks.length / state.tasks.length) * 100)
      }
    },
    tasksByDateMap(): Record<string, Task[]> {
      return this.taskIndex.byDate
    },
    tasksByDate(): (date: string) => Task[] {
      return (date: string) => this.taskIndex.byDate[date] ?? []
    },
    completedTasks(): Task[] {
      return this.taskIndex.completedTasks
    },
    pendingTasks(): Task[] {
      return this.taskIndex.pendingTasks
    },
    urgentTasks(): Task[] {
      return this.taskIndex.urgentTasks
    },
    completionRate(): number {
      return this.taskIndex.completionRate
    },
    focusHours: () => {
      return 24
    },
    streakDays: () => {
      return 4
    },
    weeklyActivity: () => {
      return [
        { day: 'Mon', count: 40 },
        { day: 'Tue', count: 65 },
        { day: 'Wed', count: 30 },
        { day: 'Thu', count: 85 },
        { day: 'Fri', count: 50 },
        { day: 'Sat', count: 20 },
        { day: 'Sun', count: 45 }
      ]
    }
  },
  actions: {
    initialize() {
      this.loading = true

      try {
        const stored = localStorage.getItem(storageKey)
        if (stored) {
          const parsed = JSON.parse(stored) as unknown
          this.tasks = Array.isArray(parsed) ? (parsed as Task[]) : []
        } else {
          this.tasks = createMockTasks()
          this.saveToStorage()
        }
      } catch (error) {
        console.error('Failed to load tasks', error)
        this.tasks = createMockTasks()
        this.saveToStorage()
      } finally {
        this.loading = false
      }

      this.startBackendEvents()
      this.startBackendReconnectPolling()
      void this.syncFromBackend()
    },

    async syncFromBackend(silent = false) {
      if (!taskApi.isConfigured) return

      this.loading = true
      try {
        const backendTasks = await taskApi.getTasks()
        const nextTasks = backendTasks.length === 0 && this.tasks.length > 0
          ? await taskApi.replaceTasks(this.tasks)
          : backendTasks

        this.tasks = nextTasks
        this.backendOnline = true
        this.saveToStorage()
        this.startBackendEvents()
      } catch (error) {
        this.backendOnline = false
        if (!silent) console.warn('Task backend is unavailable; using local storage', error)
      } finally {
        this.loading = false
      }
    },

    startBackendReconnectPolling() {
      if (!taskApi.isConfigured || backendReconnectTimer) return
      backendReconnectTimer = window.setInterval(() => {
        if (!this.backendOnline && !this.loading) void this.syncFromBackend(true)
      }, 5_000)
    },

    startBackendEvents() {
      if (!taskApi.isConfigured || taskEventSource) return

      let source: EventSource | undefined
      source = subscribeToTaskEvents(
        (event) => {
          this.backendOnline = true

          if (event.type === 'snapshot') {
            this.tasks = event.tasks
          } else if (event.type === 'created') {
            this.tasks = [
              event.task,
              ...this.tasks.filter((task) => task.id !== event.task.id)
            ]
          } else if (event.type === 'updated') {
            const index = this.tasks.findIndex((task) => task.id === event.task.id)
            if (index === -1) {
              this.tasks.unshift(event.task)
            } else {
              this.tasks[index] = event.task
            }
          } else if (event.type === 'deleted') {
            this.tasks = this.tasks.filter((task) => task.id !== event.id)
          } else if (event.type === 'cleared') {
            this.tasks = []
          }

          this.saveToStorage()
        },
        () => {
          this.backendOnline = false
          source?.close()
          if (taskEventSource === source) taskEventSource = undefined
        }
      )
      taskEventSource = source
    },

    injectMockData() {
      this.tasks = createMockTasks()
      this.saveToStorage()
      this.replaceBackendTasks()
    },

    saveToStorage() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(this.tasks))
      } catch (error) {
        console.error('Failed to save tasks', error)
      }
    },

    replaceBackendTasks() {
      if (!taskApi.isConfigured) return

      void taskApi.replaceTasks(this.tasks)
        .then((tasks) => {
          this.tasks = tasks
          this.backendOnline = true
          this.saveToStorage()
        })
        .catch((error) => {
          this.backendOnline = false
          console.warn('Failed to replace backend tasks', error)
        })
    },

    async restoreTasks(tasks: Task[]) {
      this.tasks = structuredClone(tasks)
      this.saveToStorage()
      if (!taskApi.isConfigured) return
      try {
        this.tasks = await taskApi.replaceTasks(this.tasks)
        this.backendOnline = true
        this.saveToStorage()
      } catch (error) {
        this.backendOnline = false
        throw error
      }
    },

    addTask(task: CreateTaskInput) {
      const optimisticTask: Task = {
        ...task,
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      }

      this.tasks.unshift(optimisticTask)
      this.saveToStorage()

      if (taskApi.isConfigured) {
        void taskApi.createTask(task)
          .then((serverTask) => {
            this.tasks = [
              serverTask,
              ...this.tasks.filter((item) => item.id !== optimisticTask.id && item.id !== serverTask.id)
            ]
            this.backendOnline = true
            this.saveToStorage()
          })
          .catch((error) => {
            this.backendOnline = false
            console.warn('Failed to create backend task', error)
          })
      }

      return optimisticTask
    },

    updateTask(id: string, updatedTask: UpdateTaskInput) {
      const index = this.tasks.findIndex((t) => t.id === id)
      if (index === -1) return

      this.tasks[index] = { ...this.tasks[index], ...updatedTask }
      this.saveToStorage()

      if (taskApi.isConfigured) {
        void taskApi.updateTask(id, updatedTask)
          .then((serverTask) => {
            const nextIndex = this.tasks.findIndex((task) => task.id === id)
            if (nextIndex !== -1) {
              this.tasks[nextIndex] = serverTask
              this.saveToStorage()
            }
            this.backendOnline = true
          })
          .catch((error) => {
            this.backendOnline = false
            console.warn('Failed to update backend task', error)
          })
      }
    },

    deleteTask(id: string) {
      this.tasks = this.tasks.filter((t) => t.id !== id)
      this.saveToStorage()

      if (taskApi.isConfigured) {
        void taskApi.deleteTask(id)
          .then(() => {
            this.backendOnline = true
          })
          .catch((error) => {
            this.backendOnline = false
            console.warn('Failed to delete backend task', error)
          })
      }
    },

    toggleTaskCompleted(id: string) {
      const task = this.tasks.find((t) => t.id === id)
      if (!task) return

      task.completed = !task.completed
      this.saveToStorage()

      if (taskApi.isConfigured) {
        void taskApi.toggleTaskCompleted(id)
          .then((serverTask) => {
            const index = this.tasks.findIndex((item) => item.id === id)
            if (index !== -1) {
              this.tasks[index] = serverTask
              this.saveToStorage()
            }
            this.backendOnline = true
          })
          .catch((error) => {
            this.backendOnline = false
            console.warn('Failed to toggle backend task', error)
          })
      }
    },

    clearAllTasks() {
      this.tasks = []
      this.saveToStorage()

      if (taskApi.isConfigured) {
        void taskApi.clearTasks()
          .then(() => {
            this.backendOnline = true
          })
          .catch((error) => {
            this.backendOnline = false
            console.warn('Failed to clear backend tasks', error)
          })
      }
    }
  }
})
