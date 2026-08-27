<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarCellTrigger, type CalendarCellTriggerProps, useForwardProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends CalendarCellTriggerProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const forwarded = useForwardProps(props)
</script>

<template>
  <CalendarCellTrigger
    v-bind="forwarded"
    :class="
      cn(
        'h-9 w-9 p-0 font-normal flex items-center justify-center rounded-lg text-sm text-on-surface transition-all duration-150 cursor-pointer select-none',
        'hover:bg-surface-container-highest',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'data-[selected]:bg-primary data-[selected]:text-on-primary data-[selected]:font-semibold data-[selected]:shadow-xs hover:data-[selected]:bg-primary hover:data-[selected]:opacity-90',
        'data-[today]:not([data-selected]):border data-[today]:not([data-selected]):border-primary/50 data-[today]:not([data-selected]):font-semibold',
        'data-[outside-view]:text-on-surface-variant/30 data-[outside-view]:pointer-events-none',
        'data-[disabled]:text-on-surface-variant/20 data-[disabled]:pointer-events-none',
        props.class
      )
    "
  >
    <slot />
  </CalendarCellTrigger>
</template>
