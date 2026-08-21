export type FontSizePreference = 'compact' | 'standard' | 'comfortable' | 'large'

export const FONT_SIZE_STORAGE_KEY = 'terra_font_size'
export const FONT_SIZE_OPTIONS: ReadonlyArray<{
  id: FontSizePreference
  name: string
  description: string
  pixels: number
}> = [
  { id: 'compact', name: '紧凑', description: '94%', pixels: 15 },
  { id: 'standard', name: '标准', description: '100%', pixels: 16 },
  { id: 'comfortable', name: '舒适', description: '106%', pixels: 17 },
  { id: 'large', name: '大号', description: '112.5%', pixels: 18 }
]

export function getFontSizePreference(): FontSizePreference {
  try {
    const stored = localStorage.getItem(FONT_SIZE_STORAGE_KEY)
    return FONT_SIZE_OPTIONS.some((option) => option.id === stored)
      ? stored as FontSizePreference
      : 'standard'
  } catch {
    return 'standard'
  }
}

export function applyFontSizePreference(preference: FontSizePreference, persist = true) {
  const option = FONT_SIZE_OPTIONS.find((item) => item.id === preference) || FONT_SIZE_OPTIONS[1]
  document.documentElement.style.fontSize = `${option.pixels}px`
  document.documentElement.dataset.fontSize = option.id
  if (persist) {
    try { localStorage.setItem(FONT_SIZE_STORAGE_KEY, option.id) }
    catch { /* The visual preference still applies for this session. */ }
  }
  return option.id
}

export function initializeFontSizePreference() {
  return applyFontSizePreference(getFontSizePreference(), false)
}
