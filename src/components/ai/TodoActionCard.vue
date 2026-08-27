<script setup lang="ts">
import { ref } from 'vue'
import { Check, ListChecks, ListPlus, CheckCheck } from 'lucide-vue-next'
import { useTaskStore } from '../../store/task'
import type { TodoActionItem } from '../../services/aiAgentService'

const props = defineProps<{
  action: {
    title: string
    todos: TodoActionItem[]
  }
}>()

const emit = defineEmits<{
  (e: 'added', count: number): void
}>()

const taskStore = useTaskStore()
const added = ref(false)
const isAdding = ref(false)
const selectedIndexes = ref<number[]>(props.action.todos.map((_, i) => i))

function toggleSelect(index: number) {
  if (added.value) return
  if (selectedIndexes.value.includes(index)) {
    selectedIndexes.value = selectedIndexes.value.filter((i) => i !== index)
  } else {
    selectedIndexes.value.push(index)
  }
}

async function handleAddSelected() {
  if (added.value || !selectedIndexes.value.length) return
  isAdding.value = true

  const todayStr = new Date().toISOString().split('T')[0]
  let count = 0

  try {
    for (const index of selectedIndexes.value) {
      const item = props.action.todos[index]
      if (!item) continue
      await taskStore.addTask({
        title: item.title,
        date: item.date || todayStr,
        priority: item.priority || 'Medium',
        category: item.category || 'AI提取',
        notes: item.notes || '由 synyFlow AI 助手自动整理生成',
        timeStart: '',
        timeEnd: '',
        completed: false
      })
      count++
    }
    added.value = true
    emit('added', count)
  } finally {
    isAdding.value = false
  }
}
</script>

<template>
  <div
    class="my-3 overflow-hidden rounded-2xl border p-4 transition shadow-sm"
    :class="
      added
        ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
        : 'border-outline-variant/30 bg-surface-container-lowest hover:border-primary/30'
    "
  >
    <div class="flex items-center justify-between gap-2 border-b border-outline-variant/15 pb-2.5">
      <div class="flex items-center gap-2 min-w-0">
        <div
          class="flex h-7 w-7 items-center justify-center rounded-xl transition"
          :class="added ? 'bg-primary text-on-primary' : 'bg-secondary-container text-on-secondary-container'"
        >
          <Check v-if="added" class="h-4 w-4" :stroke-width="2.5" />
          <ListChecks v-else class="h-4 w-4" :stroke-width="2" />
        </div>
        <div>
          <h4 class="text-xs font-bold text-on-surface">
            {{ added ? '已成功加入 Todo 列表' : action.title || '智能待办提取建议' }}
          </h4>
          <p class="text-[11px] text-secondary">
            {{ added ? `已入库 ${selectedIndexes.length} 项待办事项` : '点击选择需要直接同步到 Todo 的事项' }}
          </p>
        </div>
      </div>

      <button
        v-if="!added"
        class="flex items-center gap-1 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-on-primary shadow-sm hover:opacity-90 transition disabled:opacity-40"
        :disabled="isAdding || !selectedIndexes.length"
        @click="handleAddSelected"
      >
        <span v-if="isAdding" class="animate-spin text-xs">⏳</span>
        <ListPlus v-else class="h-4 w-4" :stroke-width="2" />
        <span>{{ isAdding ? '添加中...' : `一键添加 (${selectedIndexes.length})` }}</span>
      </button>
      <div v-else class="flex items-center gap-1 text-xs font-bold text-primary">
        <CheckCheck class="h-4 w-4" :stroke-width="2" />
        <span>已同步</span>
      </div>
    </div>

    <!-- 待办清单 -->
    <div class="mt-2.5 space-y-2">
      <div
        v-for="(item, idx) in action.todos"
        :key="idx"
        class="flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition text-left"
        :class="[
          selectedIndexes.includes(idx)
            ? 'border-primary/30 bg-surface-container-low'
            : 'border-transparent bg-surface-container opacity-60'
        ]"
        @click="toggleSelect(idx)"
      >
        <div class="mt-0.5 flex-shrink-0">
          <input
            type="checkbox"
            :checked="selectedIndexes.includes(idx)"
            :disabled="added"
            class="h-4 w-4 rounded text-primary focus:ring-primary"
          />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-bold text-on-surface" :class="{ 'line-through opacity-70': added }">
            {{ item.title }}
          </p>
          <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-secondary">
            <span v-if="item.date" class="rounded bg-surface-container-high px-1.5 py-0.5">
              📅 {{ item.date }}
            </span>
            <span
              v-if="item.priority"
              class="rounded px-1.5 py-0.5 font-bold"
              :class="{
                'bg-error-container text-on-error-container': item.priority === 'High',
                'bg-secondary-container text-on-secondary-container': item.priority === 'Medium',
                'bg-surface-container-high text-secondary': item.priority === 'Low'
              }"
            >
              {{ item.priority }}
            </span>
            <span v-if="item.notes" class="truncate opacity-80 max-w-[200px]">
              📝 {{ item.notes }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
