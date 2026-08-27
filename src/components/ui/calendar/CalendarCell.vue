<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarCell, type CalendarCellProps, useForwardProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends CalendarCellProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const forwarded = useForwardProps(props)
</script>

<template>
  <CalendarCell
    v-bind="forwarded"
    :class="
      cn(
        'relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([data-selected])]:rounded-lg',
        props.class
      )
    "
  >
    <slot />
  </CalendarCell>
</template>
