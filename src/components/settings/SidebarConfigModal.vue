<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  X,
  SlidersHorizontal,
  RotateCcw
} from 'lucide-vue-next'
import { useSidebarOrder, type SidebarItemDefinition } from '../../composables/useSidebarOrder'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'close'): void
}>()

const {
  sidebarItems,
  isItemEnabled,
  toggleItemEnabled,
  enableAllItems,
  resetAllConfig
} = useSidebarOrder()

const toastMessage = ref('')
let toastTimer = 0

function showToast(msg: string) {
  toastMessage.value = msg
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 2200)
}

function handleToggle(item: SidebarItemDefinition) {
  const success = toggleItemEnabled(item.key)
  if (!success) {
    showToast('至少需要保留一个侧边栏导航部件')
  }
}

function handleEnableAll() {
  enableAllItems()
  showToast('已全部启用所有侧边栏部件')
}

function handleReset() {
  resetAllConfig()
  showToast('已恢复默认排序与全部部件显示')
}

function handleClose() {
  emit('update:open', false)
  emit('close')
}

const enabledCount = computed(() => {
  return sidebarItems.value.filter((i) => isItemEnabled(i.key)).length
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sidebar-config-title"
      >
        <!-- 背景遮罩 -->
        <div
          class="fixed inset-0 bg-black/55 backdrop-blur-md transition-opacity"
          @click="handleClose"
        ></div>

        <!-- 弹窗主体卡片 -->
        <div
          class="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-outline-variant/30 bg-surface-bright shadow-2xl transition-all"
        >
          <!-- 弹窗 Header -->
          <header class="flex flex-shrink-0 items-center justify-between border-b border-outline-variant/20 px-6 py-5">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <SlidersHorizontal class="h-5 w-5" :stroke-width="2.2" />
              </div>
              <div class="min-w-0">
                <h3 id="sidebar-config-title" class="font-headline text-lg font-bold leading-tight text-on-surface">
                  侧边栏部件设置
                </h3>
                <p class="mt-0.5 text-xs text-secondary">
                  通过胶囊开关独立启用或停用侧边栏的各个导航部件
                </p>
              </div>
            </div>

            <button
              class="flex h-8 w-8 items-center justify-center rounded-full text-secondary transition hover:bg-surface-container-high hover:text-on-surface"
              aria-label="关闭"
              @click="handleClose"
            >
              <X class="h-4.5 w-4.5" :stroke-width="2" />
            </button>
          </header>

          <!-- 顶部快捷操作栏 -->
          <div class="flex flex-shrink-0 items-center justify-between border-b border-outline-variant/15 bg-surface-container-low/60 px-6 py-2.5">
            <div class="flex items-center gap-2">
              <span class="rounded-md bg-primary-container px-2 py-0.5 text-xs font-bold text-on-primary-container">
                已启用 {{ enabledCount }} / {{ sidebarItems.length }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded-lg border border-outline-variant/30 bg-surface-bright px-2.5 py-1 text-xs font-bold text-secondary transition hover:bg-surface-container-high hover:text-primary"
                @click="handleEnableAll"
              >
                全部启用
              </button>
              <button
                type="button"
                class="flex items-center gap-1 rounded-lg border border-outline-variant/30 bg-surface-bright px-2.5 py-1 text-xs font-bold text-secondary transition hover:bg-surface-container-high hover:text-primary"
                @click="handleReset"
              >
                <RotateCcw class="h-3 w-3" :stroke-width="2" />
                恢复默认
              </button>
            </div>
          </div>

          <!-- 部件卡片列表 -->
          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div class="space-y-2.5">
              <div
                v-for="item in sidebarItems"
                :key="item.key"
                class="group flex items-center justify-between gap-4 rounded-2xl border p-3.5 transition-all duration-150"
                :class="[
                  isItemEnabled(item.key)
                    ? 'border-outline-variant/30 bg-surface-container-low/40 hover:border-primary/40 hover:bg-surface-container-low'
                    : 'border-outline-variant/15 bg-surface-container-highest/20 opacity-60 hover:opacity-85'
                ]"
              >
                <div class="flex min-w-0 items-center gap-3.5">
                  <!-- 部件图标 -->
                  <div
                    class="flex h-10 w-10 flex-shrink-0 aspect-square items-center justify-center rounded-xl transition-colors"
                    :class="[
                      isItemEnabled(item.key)
                        ? 'bg-primary-container text-on-primary-container'
                        : 'bg-surface-container-highest text-secondary'
                    ]"
                  >
                    <component :is="item.icon" class="h-5 w-5 flex-shrink-0" :stroke-width="2" />
                  </div>

                  <!-- 文本信息 -->
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="font-headline text-sm font-bold text-on-surface">
                        {{ item.label }}
                      </span>
                      <span class="rounded bg-surface-container-highest/60 px-1.5 py-0.5 font-mono text-[10px] text-secondary">
                        {{ item.path }}
                      </span>
                    </div>
                    <p class="mt-0.5 truncate text-xs text-secondary">
                      {{ item.description }}
                    </p>
                  </div>
                </div>

                <!-- 胶囊开关按钮 -->
                <button
                  type="button"
                  class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  :class="isItemEnabled(item.key) ? 'bg-primary' : 'bg-surface-container-highest'"
                  :aria-label="`${item.label} ${isItemEnabled(item.key) ? '已启用' : '已停用'}`"
                  @click="handleToggle(item)"
                >
                  <span
                    class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out"
                    :class="isItemEnabled(item.key) ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
              </div>
            </div>
          </div>

          <!-- 弹窗 Footer -->
          <footer class="flex flex-shrink-0 items-center justify-between border-t border-outline-variant/20 bg-surface-container-low/40 px-6 py-4">
            <span class="text-xs text-secondary">
              修改实时生效并自动保存
            </span>
            <button
              type="button"
              class="rounded-xl bg-primary px-5 py-2 text-xs font-bold text-on-primary shadow-sm transition hover:brightness-105 active:scale-95"
              @click="handleClose"
            >
              完成
            </button>
          </footer>

          <!-- Toast 提示浮层 -->
          <Transition name="toast">
            <div
              v-if="toastMessage"
              class="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 transform rounded-full bg-on-surface px-4 py-2 text-xs font-bold text-surface shadow-lg"
            >
              {{ toastMessage }}
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}
</style>
