<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarHeadCell, type CalendarHeadCellProps, useForwardProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends CalendarHeadCellProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const forwarded = useForwardProps(props)
</script>

<template>
  <CalendarHeadCell
    v-bind="forwarded"
    :class="cn('w-9 rounded-md text-[0.8rem] font-normal text-on-surface-variant/70 text-center select-none py-1', props.class)"
  >
    <slot />
  </CalendarHeadCell>
</template>
