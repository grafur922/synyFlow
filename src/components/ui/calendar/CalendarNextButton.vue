<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarNext, type CalendarNextProps, useForwardProps } from 'reka-ui'
import { ChevronRight } from 'lucide-vue-next'
import { cn } from '@/shared/utils'

interface Props extends CalendarNextProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const forwarded = useForwardProps(props)
</script>

<template>
  <CalendarNext
    v-bind="forwarded"
    :class="
      cn(
        'h-7 w-7 flex items-center justify-center rounded-lg bg-transparent p-0 text-on-surface-variant opacity-70 hover:opacity-100 hover:bg-surface-container-high transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer disabled:pointer-events-none disabled:opacity-30',
        props.class
      )
    "
  >
    <slot>
      <ChevronRight class="h-4 w-4" />
    </slot>
  </CalendarNext>
</template>
