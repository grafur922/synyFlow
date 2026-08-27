<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarHeading, type CalendarHeadingProps, useForwardProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends CalendarHeadingProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const forwarded = useForwardProps(props)
</script>

<template>
  <CalendarHeading
    v-bind="forwarded"
    :class="cn('text-sm font-semibold font-headline text-on-surface tracking-wide', props.class)"
  >
    <slot />
  </CalendarHeading>
</template>
