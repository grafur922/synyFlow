<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import {
  CalendarRoot,
  type CalendarRootEmits,
  type CalendarRootProps,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '@/shared/utils'
import CalendarHeader from './CalendarHeader.vue'
import CalendarHeading from './CalendarHeading.vue'
import CalendarPrevButton from './CalendarPrevButton.vue'
import CalendarNextButton from './CalendarNextButton.vue'
import CalendarGrid from './CalendarGrid.vue'
import CalendarGridHead from './CalendarGridHead.vue'
import CalendarHeadCell from './CalendarHeadCell.vue'
import CalendarGridBody from './CalendarGridBody.vue'
import CalendarGridRow from './CalendarGridRow.vue'
import CalendarCell from './CalendarCell.vue'
import CalendarCellTrigger from './CalendarCellTrigger.vue'

interface Props extends CalendarRootProps {
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  locale: 'zh-CN',
  weekStartsOn: 1, // 周一开始
})

const emits = defineEmits<CalendarRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <CalendarRoot
    v-slot="{ grid, weekDays }"
    v-bind="forwarded"
    :class="cn('p-3 bg-surface-container-low/80 rounded-2xl border border-outline-variant/40 shadow-xs select-none', props.class)"
  >
    <CalendarHeader class="mb-3 px-1">
      <CalendarPrevButton />
      <CalendarHeading />
      <CalendarNextButton />
    </CalendarHeader>

    <div class="flex flex-col gap-y-4">
      <CalendarGrid v-for="month in grid" :key="month.value.toString()">
        <CalendarGridHead>
          <CalendarGridRow>
            <CalendarHeadCell
              v-for="day in weekDays"
              :key="day"
            >
              {{ day }}
            </CalendarHeadCell>
          </CalendarGridRow>
        </CalendarGridHead>
        <CalendarGridBody>
          <CalendarGridRow
            v-for="(weekDates, index) in month.rows"
            :key="`weekDate-${index}`"
          >
            <CalendarCell
              v-for="weekDate in weekDates"
              :key="weekDate.toString()"
              :date="weekDate"
            >
              <slot name="cell" :date="weekDate" :month="month.value">
                <CalendarCellTrigger
                  :day="weekDate"
                  :month="month.value"
                />
              </slot>
            </CalendarCell>
          </CalendarGridRow>
        </CalendarGridBody>
      </CalendarGrid>
    </div>
  </CalendarRoot>
</template>
