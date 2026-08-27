---
name: ui-icons
description: Guidelines and rules for UI icon selection, icon library usage (Lucide / Tabler), and custom icon creation in the Terra Hub / synyFlow project. Use when designing, creating, or modifying UI icons and action buttons.
---

# UI Icon System & Design Guidelines

This skill enforces consistency, visual excellence, and strict governance over UI icons within the Terra Hub (synyFlow) project.

---

## 1. Core Mandates

> [!IMPORTANT]
> **Core Icon Rules**:
> 1. **Never generate a new SVG icon for a standard UI action.** (e.g., search, close, delete, edit, chevron, check, settings, archive, refresh, pin, star, etc.).
> 2. **Always search the project's icon registry and standard icon libraries (Lucide / Tabler) first.**
> 3. **Create a custom icon ONLY when:**
>    - No appropriate standard icon exists in Lucide or Tabler;
>    - The concept is product-specific or domain-unique (e.g., proprietary hardware, Xiaomi sync protocol badge);
>    - The custom icon strictly conforms to the project's icon specification.

---

## 2. Icon Library Hierarchy & Selection

| Tier | Library / Source | Package | Primary Use Cases |
| :--- | :--- | :--- | :--- |
| **Tier 1 (Default)** | **Lucide Icons** | `lucide-vue-next` | All standard UI actions, navigation, controls, status indicators, and desktop OS surfaces. |
| **Tier 2 (Fallback)** | **Tabler Icons** | `@tabler/icons-vue` | Specialized domains, niche travel/hardware/file icons when Lucide lacks a fitting metaphor. |
| **Tier 3 (Custom)** | **Project Icon Registry** | `src/components/icons/` | Brand-specific, Xiaomi integration specifics, or unique proprietary concepts. |

---

## 3. Custom Icon Specification

When a custom icon is strictly necessary (Tier 3), it must follow these exact SVG parameters to blend seamlessly with Lucide/Tabler:

```html
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="lucide"
>
  <!-- Path elements here -->
</svg>
```

### Constraints:
- **Canvas Size**: `24 × 24` viewport (`viewBox="0 0 24 24"`).
- **Stroke Width**: `2px` standard (`stroke-width="2"`), or matching theme prop.
- **Stroke Endings**: `stroke-linecap="round"` and `stroke-linejoin="round"`.
- **Coloring**: `stroke="currentColor"` and `fill="none"` (unless explicitly designing a solid badge).
- **No Inline Styles**: Use Tailwind CSS classes for sizing and coloring (e.g., `class="w-4 h-4 text-primary"`).

---

## 4. Usage in Vue Components

### Direct Component Import (Lucide)
```vue
<script setup lang="ts">
import { Search, Trash2, Settings, Sparkles } from 'lucide-vue-next'
</script>

<template>
  <button class="flex items-center gap-2 text-sm text-secondary hover:text-primary">
    <Search class="h-4 w-4" />
    <span>搜索笔记</span>
  </button>
</template>
```

---

## 5. Verification Checklist

Before committing any UI changes with icons:
- [ ] No inline raw SVG for standard actions like delete, close, search, add, or arrow navigation.
- [ ] Icon is imported from `lucide-vue-next` (or `@tabler/icons-vue`).
- [ ] Visual weight and stroke match sibling controls (default 24px grid, 1.5–2px stroke).
- [ ] Colors adapt to theme tokens (`text-primary`, `text-secondary`, `text-error`, `text-on-primary`, etc.).
