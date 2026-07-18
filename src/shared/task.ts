export type TaskPriority = 'Low' | 'Medium' | 'High'

export interface Task {
  id: string
  title: string
  category: string
  date: string
  timeStart?: string
  timeEnd?: string
  priority: TaskPriority
  notes: string
  completed: boolean
}

export type CreateTaskInput = Omit<Task, 'id'>
export type UpdateTaskInput = Partial<CreateTaskInput>
