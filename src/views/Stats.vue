<script setup lang="ts">
import { computed } from 'vue'
import { useTaskStore } from '../store/task'

const taskStore = useTaskStore()

// 任务完成率
const completionRate = computed(() => taskStore.completionRate)

// 周活动量柱状图数据
const weeklyActivity = computed(() => taskStore.weeklyActivity)

// 专注时间
const focusHours = computed(() => taskStore.focusHours)

// 连续坚持天数
const streakDays = computed(() => taskStore.streakDays)

// 环形进度条的 stroke-dashoffset 计算 (r = 70, 周长 ≈ 440)
const strokeDashoffset = computed(() => {
  const c = 440
  return c - (c * completionRate.value) / 100
})
</script>

<template>
  <div class="w-full h-full overflow-y-auto bg-background text-on-background selection:bg-primary-fixed select-none pb-24 md:pb-6">
    <main class="px-6 py-6 max-w-4xl mx-auto space-y-6">
      <!-- Header Section -->
      <section class="space-y-1 animate-entrance" style="animation-delay: 0.04s;">
        <h2 class="text-headline-lg-mobile font-headline-lg-mobile text-on-background">数据统计</h2>
        <p class="text-on-surface-variant font-body-md text-sm opacity-85">回顾您的心流状态与效率进展。</p>
      </section>

      <!-- Bento Grid Layout -->
      <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
        
        <!-- Completion Rate Card -->
        <section 
          class="md:col-span-5 bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 flex flex-col items-center justify-center space-y-5 shadow-sm animate-entrance"
          style="animation-delay: 0.08s;"
        >
          <div class="relative w-40 h-40">
            <svg class="w-full h-full">
              <!-- Background circle -->
              <circle class="text-surface-container-highest" cx="80" cy="80" fill="transparent" r="70" stroke="currentColor" stroke-width="4"></circle>
              <!-- Progress circle -->
              <circle 
                class="text-primary progress-ring-circle" 
                cx="80" 
                cy="80" 
                fill="transparent" 
                r="70" 
                stroke="currentColor" 
                stroke-linecap="round" 
                stroke-width="4"
                stroke-dasharray="440"
                :stroke-dashoffset="strokeDashoffset"
              ></circle>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-headline-lg font-headline-lg text-primary">{{ completionRate }}%</span>
              <span class="text-[10px] font-label-sm text-on-surface-variant font-bold tracking-widest mt-1">COMPLETION</span>
            </div>
          </div>
          <div class="text-center">
            <h3 class="text-title-md font-title-md text-on-background">今日进度</h3>
            <p class="text-body-md text-on-surface-variant text-sm mt-1">做得不错。保持专注，继续前行。</p>
          </div>
        </section>

        <!-- Stats Column -->
        <div class="md:col-span-7 grid grid-cols-1 gap-4">
          
          <!-- Weekly Activity Card -->
          <section 
            class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 space-y-4 shadow-sm animate-entrance"
            style="animation-delay: 0.12s;"
          >
            <div class="flex justify-between items-end">
              <h3 class="text-title-md font-title-md text-on-background">每周活动量</h3>
              <span class="text-[10px] font-label-sm text-primary font-bold tracking-wider">LAST 7 DAYS</span>
            </div>
            
            <div class="flex items-end justify-between h-32 px-2 pt-2">
              <div 
                v-for="item in weeklyActivity" 
                :key="item.day" 
                class="flex flex-col items-center gap-2 w-full group"
              >
                <div class="w-2.5 bg-surface-container-highest rounded-full h-24 relative overflow-hidden">
                  <div 
                    class="absolute bottom-0 w-full bg-primary rounded-full transition-all duration-1000 ease-out" 
                    :style="{ height: item.count + '%' }"
                  ></div>
                </div>
                <span class="text-[10px] font-label-sm text-on-surface-variant font-bold group-hover:text-primary transition-colors">{{ item.day }}</span>
              </div>
            </div>
          </section>

          <!-- Small Stats Row -->
          <div class="grid grid-cols-2 gap-4">
            <!-- Focus Hours -->
            <section 
              class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-sm animate-entrance flex flex-col justify-between"
              style="animation-delay: 0.16s;"
            >
              <div>
                <span class="material-symbols-outlined text-primary mb-2 text-2xl">timer</span>
                <h4 class="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-wider font-bold">Focus Hours</h4>
              </div>
              <p class="text-headline-lg-mobile font-headline-lg-mobile text-on-background mt-2">{{ focusHours }}</p>
            </section>
            
            <!-- Current Streak -->
            <section 
              class="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-sm animate-entrance flex flex-col justify-between"
              style="animation-delay: 0.20s;"
            >
              <div>
                <span class="material-symbols-outlined text-primary mb-2 text-2xl">local_fire_department</span>
                <h4 class="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-wider font-bold">Current Streak</h4>
              </div>
              <p class="text-headline-lg-mobile font-headline-lg-mobile text-on-background mt-2">{{ streakDays }} 天</p>
            </section>
          </div>

        </div>
      </div>

      <!-- Detail Insights -->
      <section class="space-y-3 animate-entrance" style="animation-delay: 0.24s;">
        <h3 class="text-title-md font-title-md text-on-background">每日洞察 (Insights)</h3>
        <div class="bg-surface-container-low border border-outline-variant/10 rounded-xl p-4 flex items-start gap-4">
          <div class="bg-primary-container/20 p-2 rounded-lg shrink-0 text-primary">
            <span class="material-symbols-outlined text-xl">auto_awesome</span>
          </div>
          <div>
            <h4 class="text-sm font-bold text-primary">清晨高效时段</h4>
            <p class="text-xs text-on-surface-variant mt-1 leading-relaxed opacity-85">
              您的专注峰值通常出现在上午 8:00 至 10:30。建议将最富挑战性的任务或深度工作安排在这个黄金时段，以获得最佳的认知体验。
            </p>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* Progress ring stroke offset animation */
.progress-ring-circle {
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  transition: stroke-dashoffset 1s ease-out;
}
</style>
