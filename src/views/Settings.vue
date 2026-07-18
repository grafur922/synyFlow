<script setup lang="ts">
import { ref } from 'vue'
import { downloadClientBackup, exportClientBackup, restoreClientBackup } from '../services/clientBackup'
import { useTaskStore } from '../store/task'

const taskStore = useTaskStore()
const currentTheme = ref(localStorage.getItem('taskflow_theme') || 'forest')
const backupPassphrase = ref('')
const showPassphrase = ref(false)
const busy = ref(false)
const toast = ref('')
const toastError = ref(false)
let toastTimer = 0

const themes = [
  { id: 'forest', name: '森林', color: '#416463' },
  { id: 'ocean', name: '海洋', color: '#2e597a' },
  { id: 'clay', name: '陶土', color: '#855440' },
  { id: 'amber', name: '琥珀', color: '#8a641b' }
]

function changeTheme(themeId: string) {
  currentTheme.value = themeId
  localStorage.setItem('taskflow_theme', themeId)
  const root = document.documentElement
  root.classList.remove('theme-ocean', 'theme-clay', 'theme-amber')
  if (themeId !== 'forest') root.classList.add(`theme-${themeId}`)
  notify('主题已更新')
}

async function exportBackup() {
  if (busy.value) return
  busy.value = true
  try {
    const serialized = await exportClientBackup(backupPassphrase.value)
    downloadClientBackup(serialized)
    notify('客户端备份已导出')
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    busy.value = false
  }
}

async function restoreBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (!window.confirm('恢复将替换当前客户端 Todo 与界面偏好，是否继续？')) return
  busy.value = true
  try {
    const restored = await restoreClientBackup(await file.text(), backupPassphrase.value)
    downloadClientBackup(restored.beforeRestore, 'terra-client-before-restore')
    await taskStore.restoreTasks(restored.tasks)
    notify('客户端数据已恢复')
    window.setTimeout(() => window.location.reload(), 600)
  } catch (cause) {
    notify(messageFrom(cause), true)
  } finally {
    busy.value = false
  }
}

function clearTasks() {
  if (!window.confirm('此操作将清空本地 Todo；已连接后端时也会同步清空。是否继续？')) return
  taskStore.clearAllTasks()
  notify('Todo 已清空')
}

function notify(message: string, isError = false) {
  window.clearTimeout(toastTimer)
  toast.value = message
  toastError.value = isError
  toastTimer = window.setTimeout(() => { toast.value = '' }, 2600)
}

function messageFrom(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败'
}
</script>

<template>
  <div class="h-full w-full overflow-y-auto bg-background text-on-background">
    <main class="mx-auto max-w-4xl px-5 py-7 pb-28 md:px-8 md:py-10">
      <header class="mb-10">
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary">settings</span><h2 class="font-headline text-2xl font-bold">系统设置</h2></div>
        <p class="mt-2 text-sm text-secondary">{{ taskStore.backendConfigured ? taskStore.backendOnline ? 'Todo 后端已连接' : 'Todo 后端当前离线' : 'Todo 使用本地存储' }}</p>
      </header>

      <section class="border-t border-outline-variant/30 py-7">
        <div class="mb-5 flex items-center gap-3"><span class="material-symbols-outlined text-primary">palette</span><div><h3 class="font-headline text-lg font-bold">外观</h3><p class="mt-1 text-xs text-secondary">当前主题：{{ themes.find((theme) => theme.id === currentTheme)?.name }}</p></div></div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button v-for="theme in themes" :key="theme.id" type="button" class="flex min-h-14 items-center gap-3 rounded-lg border px-3 text-left text-sm font-bold transition" :class="currentTheme === theme.id ? 'border-primary bg-primary-container text-on-primary-container' : 'border-outline-variant/30 bg-surface-bright text-secondary hover:border-primary/30'" :aria-pressed="currentTheme === theme.id" @click="changeTheme(theme.id)"><span class="h-6 w-6 flex-shrink-0 rounded-full border border-black/10" :style="{ backgroundColor: theme.color }"></span><span>{{ theme.name }}</span></button>
        </div>
      </section>

      <section class="border-t border-outline-variant/30 py-7">
        <div class="mb-5 flex items-start justify-between gap-4"><div class="flex items-center gap-3"><span class="material-symbols-outlined text-primary">encrypted</span><div><h3 class="font-headline text-lg font-bold">客户端备份</h3><p class="mt-1 text-xs text-secondary">{{ taskStore.tasks.length }} 条 Todo · PBKDF2 + AES-256-GCM</p></div></div><span class="rounded-lg bg-surface-container-high px-2 py-1 text-[10px] font-bold text-secondary">本地</span></div>

        <label class="block max-w-xl text-xs font-bold text-secondary">备份口令
          <span class="mt-2 flex items-center rounded-lg border border-outline-variant/30 bg-surface-bright focus-within:ring-2 focus-within:ring-primary"><input v-model="backupPassphrase" :type="showPassphrase ? 'text' : 'password'" minlength="16" autocomplete="new-password" class="min-w-0 flex-1 border-0 bg-transparent text-sm focus:ring-0" /><button type="button" class="flex h-10 w-10 items-center justify-center text-secondary" :aria-label="showPassphrase ? '隐藏口令' : '显示口令'" @click="showPassphrase = !showPassphrase"><span class="material-symbols-outlined text-[19px]">{{ showPassphrase ? 'visibility_off' : 'visibility' }}</span></button></span>
        </label>

        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="action-button bg-primary text-on-primary" :disabled="busy" @click="exportBackup"><span class="material-symbols-outlined text-[19px]">download</span>导出</button>
          <label class="action-button cursor-pointer border border-outline-variant/40 text-primary" :class="{ 'pointer-events-none opacity-40': busy }"><span class="material-symbols-outlined text-[19px]">upload_file</span>恢复<input type="file" class="hidden" accept=".terra-client-backup,application/json" @change="restoreBackup" /></label>
        </div>
      </section>

      <section class="border-t border-outline-variant/30 py-7">
        <div class="mb-5 flex items-center gap-3"><span class="material-symbols-outlined text-error">warning</span><div><h3 class="font-headline text-lg font-bold">危险操作</h3><p class="mt-1 text-xs text-secondary">删除操作会同步到已连接的 Todo 后端</p></div></div>
        <button type="button" class="action-button border border-error/40 text-error hover:bg-error-container/40" @click="clearTasks"><span class="material-symbols-outlined text-[19px]">delete_sweep</span>清空 Todo</button>
      </section>

      <section class="border-t border-outline-variant/30 py-7 text-xs text-secondary">
        <div class="flex flex-wrap items-center justify-between gap-3"><span>Terra Hub 0.1.0</span><span>Vue 3 · NestJS · Tauri 2</span></div>
      </section>
    </main>

    <Transition name="toast">
      <div v-if="toast" role="status" class="fixed left-1/2 top-6 z-[120] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-3 text-sm font-bold shadow-xl" :class="toastError ? 'bg-error-container text-on-error-container' : 'bg-primary text-on-primary'"><span class="material-symbols-outlined text-[19px]">{{ toastError ? 'error' : 'check_circle' }}</span><span class="break-words">{{ toast }}</span></div>
    </Transition>
  </div>
</template>

<style scoped>
.action-button {
  @apply flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
</style>
