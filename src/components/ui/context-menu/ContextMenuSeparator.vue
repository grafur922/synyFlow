<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ContextMenuSeparator, type ContextMenuSeparatorProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends ContextMenuSeparatorProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <ContextMenuSeparator
    v-bind="props"
    :class="cn('-mx-1 my-1 h-px bg-outline-variant/30', props.class)"
  />
</template>
