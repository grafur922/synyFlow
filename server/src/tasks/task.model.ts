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

export type TaskEvent =
  | { type: 'created' | 'updated'; task: Task; timestamp: string }
  | { type: 'deleted'; id: string; timestamp: string }
  | { type: 'cleared'; timestamp: string }
  | { type: 'snapshot'; tasks: Task[]; timestamp: string }
