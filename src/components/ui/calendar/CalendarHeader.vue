<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarHeader, type CalendarHeaderProps, useForwardProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends CalendarHeaderProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const forwarded = useForwardProps(props)
</script>

<template>
  <CalendarHeader
    v-bind="forwarded"
    :class="cn('relative flex w-full items-center justify-between pt-1', props.class)"
  >
    <slot />
  </CalendarHeader>
</template>
