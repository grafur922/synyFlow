<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarGridRow, type CalendarGridRowProps, useForwardProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends CalendarGridRowProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const forwarded = useForwardProps(props)
</script>

<template>
  <CalendarGridRow
    v-bind="forwarded"
    :class="cn('flex w-full justify-between mt-1', props.class)"
  >
    <slot />
  </CalendarGridRow>
</template>
