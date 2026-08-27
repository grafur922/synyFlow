<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import {
  DropdownMenuSeparator,
  type DropdownMenuSeparatorProps,
} from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends DropdownMenuSeparatorProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <DropdownMenuSeparator
    v-bind="props"
    :class="cn('-mx-1 my-1 h-px bg-outline-variant/30', props.class)"
  />
</template>
