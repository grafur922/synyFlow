<script setup lang="ts">
import { ref } from 'vue'
import { Brain, X, Plus, Trash2, Tag, Calendar } from 'lucide-vue-next'
import { useUserMemory, type UserMemoryItem } from '../../composables/useUserMemory'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
}>()

const { memories, addMemory, removeMemory, clearAllMemories } = useUserMemory()

const newContent = ref('')
const newCategory = ref<UserMemoryItem['category']>('preference')

function handleAdd() {
  if (!newContent.value.trim()) return
  addMemory(newContent.value.trim(), newCategory.value)
  newContent.value = ''
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getCategoryBadge(cat: string) {
  if (cat === 'preference') return { label: '偏好', bg: 'bg-primary/10 text-primary border-primary/20' }
  if (cat === 'habit') return { label: '习惯', bg: 'bg-tertiary-container text-on-tertiary-container border-outline-variant/30' }
  return { label: '事实', bg: 'bg-secondary-container text-on-secondary-container border-outline-variant/30' }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 backdrop-blur-xs p-4 animate-in fade-in duration-200"
    @click.self="emit('update:open', false)"
  >
    <div
      class="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-2xl transition-all"
    >
      <!-- 头部 -->
      <div class="flex items-center justify-between border-b border-outline-variant/15 px-6 py-4">
        <div class="flex items-center gap-2.5">
          <div class="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
            <Brain class="h-5 w-5" :stroke-width="2" />
          </div>
          <div>
            <h3 class="font-headline text-base font-bold text-on-surface">长期记忆库</h3>
            <p class="text-xs text-secondary font-body">AI 在对话中自动提炼或由你添加的个性化偏好与事实</p>
          </div>
        </div>

        <button
          class="flex h-8 w-8 items-center justify-center rounded-full text-secondary transition hover:bg-surface-container hover:text-on-surface"
          @click="emit('update:open', false)"
        >
          <X class="h-4 w-4" :stroke-width="2" />
        </button>
      </div>

      <!-- 添加新记忆表单 -->
      <div class="border-b border-outline-variant/15 bg-surface-container/40 p-4">
        <div class="flex flex-col gap-2.5">
          <div class="flex items-center gap-2">
            <input
              v-model="newContent"
              type="text"
              placeholder="添加一条偏好 (如：喜欢在下午安排游泳锻炼)..."
              class="flex-1 rounded-xl border border-outline-variant/40 bg-surface px-3 py-2 text-xs text-on-surface placeholder:text-secondary/50 focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary/20"
              @keyup.enter="handleAdd"
            />

            <select
              v-model="newCategory"
              class="rounded-xl border border-outline-variant/40 bg-surface px-2.5 py-2 text-xs font-bold text-on-surface focus:border-primary focus:outline-hidden"
            >
              <option value="preference">偏好</option>
              <option value="habit">习惯</option>
              <option value="fact">事实</option>
            </select>

            <button
              class="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-on-primary shadow-xs transition hover:opacity-90 disabled:opacity-50"
              :disabled="!newContent.trim()"
              @click="handleAdd"
            >
              <Plus class="h-3.5 w-3.5" :stroke-width="2" />
              <span>记录</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 记忆列表 -->
      <div class="flex-1 overflow-y-auto p-4 space-y-2.5 min-h-[220px]">
        <div v-if="!memories.length" class="flex flex-col items-center justify-center py-12 text-center">
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-container text-secondary/60 mb-2">
            <Tag class="h-6 w-6" :stroke-width="1.5" />
          </div>
          <p class="text-xs font-bold text-on-surface">暂无沉淀的记忆</p>
          <p class="mt-1 text-[11px] text-secondary">在聊天中告诉 AI 你的习惯或喜好，AI 会自动记录沉淀</p>
        </div>

        <div
          v-for="item in memories"
          :key="item.id"
          class="group flex items-start justify-between gap-3 rounded-2xl border border-outline-variant/25 bg-surface p-3 transition hover:border-primary/30 hover:shadow-xs"
        >
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex items-center gap-2">
              <span
                class="rounded-md border px-1.5 py-0.2 text-[10px] font-bold"
                :class="getCategoryBadge(item.category).bg"
              >
                {{ getCategoryBadge(item.category).label }}
              </span>
              <span class="flex items-center gap-0.5 text-[10px] font-mono text-secondary">
                <Calendar class="h-2.5 w-2.5 opacity-60" />
                {{ formatDate(item.updatedAt) }}
              </span>
            </div>
            <p class="text-xs leading-relaxed text-on-surface font-body select-text">
              {{ item.content }}
            </p>
          </div>

          <button
            class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-secondary opacity-40 transition hover:bg-error/10 hover:text-error hover:opacity-100 group-hover:opacity-80"
            @click="removeMemory(item.id)"
            title="删除此条记忆"
          >
            <Trash2 class="h-3.5 w-3.5" :stroke-width="1.8" />
          </button>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="flex items-center justify-between border-t border-outline-variant/15 bg-surface-container/20 px-6 py-3">
        <span class="text-[11px] text-secondary">共 {{ memories.length }} 条长期记忆</span>
        <button
          v-if="memories.length > 0"
          class="text-xs font-bold text-error/80 hover:text-error hover:underline transition"
          @click="clearAllMemories"
        >
          清空全部记忆
        </button>
      </div>
    </div>
  </div>
</template>
