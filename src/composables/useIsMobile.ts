import { onMounted, onUnmounted, ref } from 'vue'

const mobileQuery = '(max-width: 767px)'

export function useIsMobile() {
  const isMobile = ref(typeof window !== 'undefined' ? window.matchMedia(mobileQuery).matches : false)
  let mediaQuery: MediaQueryList | undefined

  const update = () => {
    if (mediaQuery) {
      isMobile.value = mediaQuery.matches
    }
  }

  onMounted(() => {
    mediaQuery = window.matchMedia(mobileQuery)
    update()
    mediaQuery.addEventListener('change', update)
  })

  onUnmounted(() => {
    mediaQuery?.removeEventListener('change', update)
  })

  return isMobile
}
