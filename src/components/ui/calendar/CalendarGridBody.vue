<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarGridBody, type CalendarGridBodyProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends CalendarGridBodyProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <CalendarGridBody :class="cn('space-y-1', props.class)">
    <slot />
  </CalendarGridBody>
</template>
