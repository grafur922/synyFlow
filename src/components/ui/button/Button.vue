<script lang="ts">
import { cva, type VariantProps } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98] select-none cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary shadow-sm hover:opacity-90 active:opacity-100',
        secondary: 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest active:bg-surface-container-high',
        outline: 'border border-outline-variant bg-surface text-on-surface hover:bg-surface-container-low active:bg-surface-container',
        ghost: 'text-on-surface hover:bg-surface-container-high active:bg-surface-container-highest',
        tonal: 'bg-secondary-container text-on-secondary-container hover:opacity-90',
        danger: 'bg-error text-on-error hover:opacity-90 active:opacity-100',
      },
      size: {
        sm: 'h-8 px-3 text-xs gap-1.5',
        default: 'h-10 px-4 py-2 gap-2',
        lg: 'h-12 px-6 text-base gap-2.5',
        icon: 'h-9 w-9 p-0',
        'icon-sm': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
</script>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Primitive, type PrimitiveProps } from 'reka-ui'
import { cn } from '@/shared/utils'

interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  variant: 'primary',
  size: 'default',
})
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), props.class)"
    :disabled="disabled"
  >
    <slot />
  </Primitive>
</template>
