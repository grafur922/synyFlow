<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'

const chatContainer = ref<HTMLElement | null>(null)
const inputMessage = ref('')
const messages = ref([
  {
    id: 'msg-init',
    text: '你好！我是您的 AI 效率助手。描述您的日程，我会帮您规划并安排好所有的待办事项。',
    isUser: false
  }
])

const scrollToBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTo({
      top: chatContainer.value.scrollHeight,
      behavior: 'smooth'
    })
  }
}

const sendMessage = (text: string) => {
  if (!text.trim()) return

  // 1. User Message
  messages.value.push({
    id: `msg-${Date.now()}`,
    text: text.trim(),
    isUser: true
  })
  scrollToBottom()

  // 2. Mock AI response
  setTimeout(() => {
    let reply = '好的，已为您编排相关日程。我已经帮您将明天上午的时间段留给深度工作，并在下午自动清理了无关联的会议。'
    if (text.includes('周') || text.includes('星期')) {
      reply = '明白。我已经根据您的工作优先级，将主要精力块分配到了周二和周四的上午高峰期，并将低优先级的杂务堆叠安排在周五下午。'
    } else if (text.includes('清晨') || text.includes('早')) {
      reply = '没问题。清晨首个任务已为您排定为“专注时间”。建议在此期间推迟所有的社交与通讯打扰，获得深度聚焦体验。'
    }
    
    messages.value.push({
      id: `msg-${Date.now() + 1}`,
      text: reply,
      isUser: false
    })
    scrollToBottom()
  }, 1000)
}

const handleSend = () => {
  if (inputMessage.value.trim()) {
    sendMessage(inputMessage.value)
    inputMessage.value = ''
  }
}

onMounted(() => {
  scrollToBottom()
})
</script>

<template>
  <div class="flex-grow flex flex-col h-full bg-background relative overflow-hidden select-none pb-24 md:pb-6">
    <!-- Background Watermark -->
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] select-none z-0">
      <span class="material-symbols-outlined text-[200px]">auto_stories</span>
    </div>

    <!-- Header Section -->
    <header class="flex-shrink-0 px-6 py-4 border-b border-outline-variant/30 flex items-center gap-4 z-10 bg-background/80 backdrop-blur-md">
      <div class="p-2 bg-primary-container/10 rounded-lg text-primary">
        <span class="material-symbols-outlined">auto_awesome</span>
      </div>
      <div>
        <h2 class="font-headline text-xl font-bold text-on-background">AI 编排助手</h2>
        <p class="text-xs text-secondary mt-0.5">对话式日程编排与专注分析</p>
      </div>
    </header>

    <!-- Chat History -->
    <div 
      ref="chatContainer"
      class="flex-grow overflow-y-auto px-6 py-6 space-y-6 z-10 flex flex-col"
    >
      <div 
        v-for="msg in messages" 
        :key="msg.id" 
        :class="msg.isUser ? 'justify-end' : 'justify-start'"
        class="flex w-full animate-entrance"
      >
        <div 
          :class="[
            msg.isUser 
              ? 'bg-primary text-on-primary rounded-tr-none' 
              : 'bg-surface-container-lowest border border-outline-variant/30 text-on-surface rounded-tl-none'
          ]"
          class="max-w-[85%] px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed"
        >
          {{ msg.text }}
        </div>
      </div>
    </div>

    <!-- Bottom Input and Quick Actions -->
    <div class="flex-shrink-0 px-6 pb-6 pt-2 z-10 bg-gradient-to-t from-background via-background to-transparent">
      <!-- Quick Action Pills -->
      <div class="flex gap-2 overflow-x-auto pb-3 no-scrollbar">
        <button 
          @click="sendMessage('为我安排本周的日程')"
          class="flex-shrink-0 px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-full text-xs font-semibold text-primary hover:bg-surface-container-high transition-colors active:scale-95 duration-200"
        >
          为我安排本周的日程
        </button>
        <button 
          @click="sendMessage('规划明天的任务优先级')"
          class="flex-shrink-0 px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-full text-xs font-semibold text-primary hover:bg-surface-container-high transition-colors active:scale-95 duration-200"
        >
          规划明天的任务优先级
        </button>
        <button 
          @click="sendMessage('设定清晨的高效工作流')"
          class="flex-shrink-0 px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-full text-xs font-semibold text-primary hover:bg-surface-container-high transition-colors active:scale-95 duration-200"
        >
          设定清晨的高效工作流
        </button>
      </div>

      <!-- Input Shell -->
      <div class="relative flex items-center bg-surface-container-lowest border border-outline-variant/50 rounded-full px-4 py-2 shadow-sm">
        <span class="material-symbols-outlined text-outline mr-2 text-lg">chat_bubble</span>
        <input 
          v-model="inputMessage"
          @keydown.enter="handleSend"
          class="flex-grow bg-transparent border-none focus:ring-0 text-sm font-body text-on-surface placeholder:text-outline/50 p-0 focus:outline-none" 
          placeholder="和 AI 聊聊您的日程计划..." 
          type="text"
        />
        <button 
          @click="handleSend"
          class="w-8 h-8 bg-primary text-on-primary rounded-full flex items-center justify-center active:scale-90 transition-transform duration-200"
        >
          <span class="material-symbols-outlined text-base filled">send</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
