<script lang="ts">
import { cva, type VariantProps } from 'class-variance-authority'

export const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors select-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-on-primary',
        secondary: 'bg-secondary-container text-on-secondary-container',
        outline: 'border border-outline-variant text-on-surface',
        surface: 'bg-surface-container text-on-surface-variant',
        danger: 'bg-error/15 text-error',
        success: 'bg-emerald-500/15 text-emerald-700',
        warning: 'bg-amber-500/15 text-amber-800',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export type BadgeVariants = VariantProps<typeof badgeVariants>
</script>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/shared/utils'

interface Props {
  variant?: BadgeVariants['variant']
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
})
</script>

<template>
  <div :class="cn(badgeVariants({ variant }), props.class)">
    <slot />
  </div>
</template>
