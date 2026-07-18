import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/todo' },
  { path: '/dashboard', redirect: '/todo' },
  { path: '/tasks', redirect: '/todo' },
  {
    path: '/todo',
    name: 'Todo',
    component: () => import('../views/Dashboard.vue')
  },
  {
    path: '/xiaomi-notes',
    name: 'XiaomiNotes',
    component: () => import('../views/XiaomiNotes.vue')
  },
  {
    path: '/search',
    name: 'GlobalSearch',
    component: () => import('../views/GlobalSearch.vue')
  },
  {
    path: '/knowledge',
    name: 'KnowledgeBase',
    component: () => import('../views/KnowledgeBase.vue')
  },
  {
    path: '/rss',
    name: 'RssReader',
    component: () => import('../views/RssReader.vue')
  },
  {
    path: '/blog',
    name: 'BlogEditor',
    component: () => import('../views/BlogEditor.vue')
  },
  {
    path: '/calendar',
    name: 'Calendar',
    component: () => import('../views/CalendarView.vue')
  },
  {
    path: '/stats',
    name: 'Stats',
    component: () => import('../views/Stats.vue')
  },
  {
    path: '/task-details/:id?',
    name: 'TaskDetails',
    component: () => import('../views/TaskDetails.vue')
  },
  {
    path: '/travel',
    name: 'TravelPlanner',
    component: () => import('../views/TravelPlanner.vue')
  },
  { path: '/ai-plan', redirect: '/travel' },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/Settings.vue')
  },
  { path: '/:pathMatch(.*)*', redirect: '/todo' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

export default router
