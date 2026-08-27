import { ref } from 'vue'

const primarySidebarEnabled = ref(localStorage.getItem('synyflow_primary_sidebar_enabled') !== 'false') // 默认启用
const primarySidebarCollapsed = ref(localStorage.getItem('terra_primary_sidebar_collapsed') === 'true')
const autoCollapseOnEdit = ref(localStorage.getItem('synyflow_auto_collapse_on_edit') !== 'false') // 默认开启

export function usePrimarySidebar() {
  const setPrimarySidebarEnabled = (enabled: boolean) => {
    primarySidebarEnabled.value = enabled
    localStorage.setItem('synyflow_primary_sidebar_enabled', String(enabled))
  }

  const setCollapsed = (collapsed: boolean) => {
    primarySidebarCollapsed.value = collapsed
    localStorage.setItem('terra_primary_sidebar_collapsed', String(collapsed))
  }

  const toggleCollapsed = () => {
    setCollapsed(!primarySidebarCollapsed.value)
  }

  const setAutoCollapseOnEdit = (enabled: boolean) => {
    autoCollapseOnEdit.value = enabled
    localStorage.setItem('synyflow_auto_collapse_on_edit', String(enabled))
  }

  return {
    primarySidebarEnabled,
    primarySidebarCollapsed,
    autoCollapseOnEdit,
    setPrimarySidebarEnabled,
    setCollapsed,
    toggleCollapsed,
    setAutoCollapseOnEdit
  }
}
