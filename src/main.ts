import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useTaskStore } from './store/task'
import { initializeFontSizePreference } from './services/appearance'
import './index.css'

initializeFontSizePreference()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// 初始化本地存储中的待办数据
const taskStore = useTaskStore()
taskStore.initialize()

app.mount('#app')
