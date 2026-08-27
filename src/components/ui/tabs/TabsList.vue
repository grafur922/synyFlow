<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { TabsList, type TabsListProps, useForwardProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends TabsListProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const forwarded = useForwardProps(props)
</script>

<template>
  <TabsList
    v-bind="forwarded"
    :class="
      cn(
        'inline-flex h-10 items-center justify-center rounded-xl bg-surface-container p-1 text-on-surface-variant select-none',
        props.class
      )
    "
  >
    <slot />
  </TabsList>
</template>
