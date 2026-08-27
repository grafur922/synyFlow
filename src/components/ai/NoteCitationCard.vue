<script setup lang="ts">
import { useRouter } from 'vue-router'
import { FileText, ExternalLink, Calendar } from 'lucide-vue-next'

const props = defineProps<{
  citation: {
    number?: number
    documentId: string
    documentTitle: string
    heading?: string
    excerpt?: string
    score?: number
    updatedAt?: number
  }
}>()

const router = useRouter()

function openInXiaomiNotes() {
  if (!props.citation.documentId) return
  // 跳转到小米笔记页面并尝试定位
  router.push({
    path: '/xiaomi-notes',
    query: { noteId: props.citation.documentId }
  })
}

function formatDate(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
</script>

<template>
  <div
    class="group relative my-2 overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest/90 p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0">
        <div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText class="h-3.5 w-3.5" :stroke-width="2" />
        </div>
        <span class="truncate text-xs font-bold text-on-surface">{{ citation.documentTitle }}</span>
        <span v-if="citation.heading" class="truncate text-[11px] text-secondary">/ {{ citation.heading }}</span>
      </div>

      <div class="flex items-center gap-1.5 flex-shrink-0">
        <span
          v-if="citation.updatedAt"
          class="flex items-center gap-0.5 rounded-md bg-surface-container-high px-1.5 py-0.5 text-[10px] font-mono text-secondary"
          title="笔记更新时间"
        >
          <Calendar class="h-2.5 w-2.5 opacity-60" />
          <span>{{ formatDate(citation.updatedAt) }}</span>
        </span>
        <span
          v-if="citation.score !== undefined"
          class="rounded-md bg-secondary-container px-1.5 py-0.5 text-[10px] font-bold text-on-secondary-container"
        >
          相关度 {{ Math.round(citation.score * 100) }}%
        </span>
        <button
          class="flex items-center gap-0.5 rounded-md bg-surface-container-high px-2 py-0.5 text-[11px] font-bold text-primary opacity-90 transition hover:bg-primary hover:text-on-primary"
          @click="openInXiaomiNotes"
          title="跳转到小米笔记查看完整正文"
        >
          <span>查看</span>
          <ExternalLink class="h-3 w-3" :stroke-width="2" />
        </button>
      </div>
    </div>

    <p v-if="citation.excerpt" class="mt-2 line-clamp-2 text-xs leading-relaxed text-secondary font-body">
      {{ citation.excerpt }}
    </p>
  </div>
</template>
