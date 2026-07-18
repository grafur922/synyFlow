import type { CreateTaskInput, TaskPriority } from '../task.model'

export class CreateTaskDto implements CreateTaskInput {
  title!: string
  category!: string
  date!: string
  timeStart?: string
  timeEnd?: string
  priority!: TaskPriority
  notes!: string
  completed!: boolean
}
