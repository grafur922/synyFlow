import type { UpdateTaskInput, TaskPriority } from '../task.model'

export class UpdateTaskDto implements UpdateTaskInput {
  title?: string
  category?: string
  date?: string
  timeStart?: string
  timeEnd?: string
  priority?: TaskPriority
  notes?: string
  completed?: boolean
}
