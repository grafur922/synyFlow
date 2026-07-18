import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Sse } from '@nestjs/common'
import { map } from 'rxjs'
import { CreateTaskDto } from './dto/create-task.dto'
import { UpdateTaskDto } from './dto/update-task.dto'
import type { Task, TaskEvent } from './task.model'
import { TasksService } from './tasks.service'

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findAll() {
    return this.tasksService.findAll()
  }

  @Sse('events/stream')
  streamEvents() {
    return this.tasksService.getEvents().pipe(map((event: TaskEvent) => ({ data: event })))
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id)
  }

  @Post()
  create(@Body() task: CreateTaskDto) {
    return this.tasksService.create(task)
  }

  @Put()
  replaceAll(@Body() tasks: Task[]) {
    return this.tasksService.replaceAll(tasks)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() task: UpdateTaskDto) {
    return this.tasksService.update(id, task)
  }

  @Patch(':id/toggle')
  toggleCompleted(@Param('id') id: string) {
    return this.tasksService.toggleCompleted(id)
  }

  @Delete()
  clear() {
    return this.tasksService.clear()
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tasksService.remove(id)
  }
}
