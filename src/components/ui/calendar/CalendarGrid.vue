<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarGrid, type CalendarGridProps, useForwardProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends CalendarGridProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const forwarded = useForwardProps(props)
</script>

<template>
  <CalendarGrid
    v-bind="forwarded"
    :class="cn('w-full border-collapse space-y-1', props.class)"
  >
    <slot />
  </CalendarGrid>
</template>
