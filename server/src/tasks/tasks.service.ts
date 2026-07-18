import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Subject } from 'rxjs'
import type { CreateTaskInput, Task, TaskEvent, TaskPriority, UpdateTaskInput } from './task.model'

const priorities: TaskPriority[] = ['Low', 'Medium', 'High']

type TaskEventPayload =
  | { type: 'created' | 'updated'; task: Task }
  | { type: 'deleted'; id: string }
  | { type: 'cleared' }
  | { type: 'snapshot'; tasks: Task[] }

@Injectable()
export class TasksService {
  private readonly dataFile = process.env.TERRA_DATA_FILE || join(process.cwd(), 'data', 'tasks.json')
  private readonly events = new Subject<TaskEvent>()
  private readonly ready: Promise<void>
  private tasks: Task[] = []
  private persistQueue: Promise<void> = Promise.resolve()

  constructor() {
    this.ready = this.load()
  }

  getEvents() {
    return this.events.asObservable()
  }

  async findAll() {
    await this.ready
    return [...this.tasks]
  }

  async findOne(id: string) {
    await this.ready
    const task = this.tasks.find((item) => item.id === id)

    if (!task) {
      throw new NotFoundException(`Task ${id} was not found`)
    }

    return task
  }

  async create(input: CreateTaskInput) {
    await this.ready
    const task: Task = {
      ...this.normalizeCreate(input),
      id: this.createId()
    }

    this.tasks = [task, ...this.tasks]
    await this.persist()
    this.emit({ type: 'created', task })
    return task
  }

  async update(id: string, input: UpdateTaskInput) {
    await this.ready
    const index = this.tasks.findIndex((item) => item.id === id)

    if (index === -1) {
      throw new NotFoundException(`Task ${id} was not found`)
    }

    const task = {
      ...this.tasks[index],
      ...this.normalizeUpdate(input)
    }

    this.tasks = [
      ...this.tasks.slice(0, index),
      task,
      ...this.tasks.slice(index + 1)
    ]

    await this.persist()
    this.emit({ type: 'updated', task })
    return task
  }

  async toggleCompleted(id: string) {
    const task = await this.findOne(id)
    return this.update(id, { completed: !task.completed })
  }

  async remove(id: string) {
    await this.ready
    const nextTasks = this.tasks.filter((item) => item.id !== id)

    if (nextTasks.length === this.tasks.length) {
      throw new NotFoundException(`Task ${id} was not found`)
    }

    this.tasks = nextTasks
    await this.persist()
    this.emit({ type: 'deleted', id })
  }

  async clear() {
    await this.ready
    this.tasks = []
    await this.persist()
    this.emit({ type: 'cleared' })
  }

  async replaceAll(input: Task[]) {
    await this.ready
    if (!Array.isArray(input)) throw new BadRequestException('Task list must be an array')
    if (input.length > 10_000) throw new BadRequestException('Task list is too large')
    this.tasks = input.map((task) => this.normalizeExisting(task))
    await this.persist()
    this.emit({ type: 'snapshot', tasks: [...this.tasks] })
    return [...this.tasks]
  }

  private async load() {
    try {
      const raw = await readFile(this.dataFile, 'utf8')
      const parsed = JSON.parse(raw) as unknown

      if (!Array.isArray(parsed)) {
        throw new Error('Task store must be an array')
      }

      this.tasks = parsed.map((task) => this.normalizeExisting(task))
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        console.warn('Failed to load task store, starting empty', error)
      }

      this.tasks = []
      await this.persist()
    }
  }

  private persist() {
    const snapshot = JSON.stringify(this.tasks, null, 2)
    const write = async () => {
      await mkdir(dirname(this.dataFile), { recursive: true })
      await writeFile(this.dataFile, snapshot, 'utf8')
    }
    this.persistQueue = this.persistQueue.then(write, write)
    return this.persistQueue
  }

  private emit(event: TaskEventPayload) {
    this.events.next({
      ...event,
      timestamp: new Date().toISOString()
    })
  }

  private normalizeExisting(input: unknown): Task {
    const task = input as Partial<Task>
    const id = this.cleanString(task.id)

    if (!id) {
      throw new BadRequestException('Task id is required')
    }

    return {
      ...this.normalizeCreate(task as CreateTaskInput),
      id
    }
  }

  private normalizeCreate(input: Partial<CreateTaskInput>): CreateTaskInput {
    const title = this.cleanString(input.title)
    const category = this.cleanString(input.category)
    const date = this.cleanString(input.date)
    const priority = input.priority

    if (!title) {
      throw new BadRequestException('Task title is required')
    }

    if (!category) {
      throw new BadRequestException('Task category is required')
    }

    if (!this.isDate(date)) {
      throw new BadRequestException('Task date must use YYYY-MM-DD')
    }

    if (!priority || !priorities.includes(priority)) {
      throw new BadRequestException('Task priority is invalid')
    }

    return {
      title,
      category,
      date,
      timeStart: this.optionalString(input.timeStart),
      timeEnd: this.optionalString(input.timeEnd),
      priority,
      notes: this.cleanString(input.notes),
      completed: Boolean(input.completed)
    }
  }

  private normalizeUpdate(input: UpdateTaskInput): UpdateTaskInput {
    const patch: UpdateTaskInput = {}

    if ('title' in input) {
      const title = this.cleanString(input.title)
      if (!title) throw new BadRequestException('Task title is required')
      patch.title = title
    }

    if ('category' in input) {
      const category = this.cleanString(input.category)
      if (!category) throw new BadRequestException('Task category is required')
      patch.category = category
    }

    if ('date' in input) {
      const date = this.cleanString(input.date)
      if (!this.isDate(date)) throw new BadRequestException('Task date must use YYYY-MM-DD')
      patch.date = date
    }

    if ('timeStart' in input) patch.timeStart = this.optionalString(input.timeStart)
    if ('timeEnd' in input) patch.timeEnd = this.optionalString(input.timeEnd)

    if ('priority' in input) {
      if (!input.priority || !priorities.includes(input.priority)) {
        throw new BadRequestException('Task priority is invalid')
      }
      patch.priority = input.priority
    }

    if ('notes' in input) patch.notes = this.cleanString(input.notes)
    if ('completed' in input) patch.completed = Boolean(input.completed)

    return patch
  }

  private cleanString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private optionalString(value: unknown) {
    const text = this.cleanString(value)
    return text || undefined
  }

  private isDate(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
  }

  private createId() {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}
