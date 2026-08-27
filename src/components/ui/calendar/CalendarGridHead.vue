<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CalendarGridHead, type CalendarGridHeadProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends CalendarGridHeadProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <CalendarGridHead :class="cn('', props.class)">
    <slot />
  </CalendarGridHead>
</template>
