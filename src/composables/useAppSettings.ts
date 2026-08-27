import { ref } from 'vue'

const storedInterval = Number(localStorage.getItem('synyflow_urgent_carousel_interval'))
const urgentCarouselInterval = ref<number>(
  Number.isFinite(storedInterval) && storedInterval >= 1 && storedInterval <= 60 ? Math.round(storedInterval) : 4
)

const storedContainerSize = Number(localStorage.getItem('terra_sidebar_container_size'))
const sidebarContainerSize = ref<number>(
  Number.isFinite(storedContainerSize) && storedContainerSize >= 32 && storedContainerSize <= 56
    ? Math.round(storedContainerSize)
    : 42
)

export function useAppSettings() {
  const setUrgentCarouselInterval = (seconds: number) => {
    const parsed = Number(seconds)
    const valid = Number.isFinite(parsed) ? Math.min(60, Math.max(1, Math.round(parsed))) : 4
    urgentCarouselInterval.value = valid
    localStorage.setItem('synyflow_urgent_carousel_interval', String(valid))
  }

  const setSidebarContainerSize = (size: number) => {
    const parsed = Number(size)
    const valid = Number.isFinite(parsed) ? Math.min(56, Math.max(32, Math.round(parsed))) : 42
    sidebarContainerSize.value = valid
    localStorage.setItem('terra_sidebar_container_size', String(valid))
  }

  return {
    urgentCarouselInterval,
    setUrgentCarouselInterval,
    sidebarContainerSize,
    setSidebarContainerSize
  }
}
