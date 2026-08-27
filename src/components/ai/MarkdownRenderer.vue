<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import java from 'highlight.js/lib/languages/java'
import katex from 'katex'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('go', go)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('java', java)

interface Props {
  content: string
  isStreaming?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  isStreaming: false,
})

const containerRef = ref<HTMLElement | null>(null)

// 1. 初始化 Marked 解析器配置
const marked = new Marked({
  gfm: true,
  breaks: true,
})

// 流式生成时的未闭合标记自愈补全（如未闭合的代码块 ```、未闭合的数学公式 $$ 等）
function autoCloseMarkdown(raw: string, isStreaming: boolean): string {
  if (!isStreaming || !raw) return raw

  let text = raw

  // 1. 自愈补全未闭合的代码块 ```
  const codeBlockMatches = text.match(/```/g)
  if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
    text += '\n```'
  }

  // 2. 自愈补全未闭合的块级 LaTeX 公式 $$
  const latexBlockMatches = text.match(/\$\$/g)
  if (latexBlockMatches && latexBlockMatches.length % 2 !== 0) {
    text += '\n$$'
  }

  return text
}

// 安全渲染 LaTeX 公式
function renderLatex(text: string): string {
  if (!text) return ''

  // 1. 处理块级公式 $$ ... $$ 和 \[ ... \]
  let processed = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, equation) => {
    try {
      return `<div class="my-3 overflow-x-auto text-center">${katex.renderToString(equation.trim(), {
        displayMode: true,
        throwOnError: false,
      })}</div>`
    } catch {
      return `$$\n${equation}\n$$`
    }
  }).replace(/\\\[([\s\S]*?)\\\]/g, (_, equation) => {
    try {
      return `<div class="my-3 overflow-x-auto text-center">${katex.renderToString(equation.trim(), {
        displayMode: true,
        throwOnError: false,
      })}</div>`
    } catch {
      return `\\[\n${equation}\n\\]`
    }
  })

  // 2. 处理行内公式 $ ... $ 和 \( ... \)
  processed = processed.replace(/(?<!\\)\$([^\$\n]+?)\$/g, (match, equation) => {
    if (/^\s*\d+(\.\d+)?\s*$/.test(equation)) return match
    try {
      return katex.renderToString(equation.trim(), {
        displayMode: false,
        throwOnError: false,
      })
    } catch {
      return match
    }
  }).replace(/\\\(([\s\S]*?)\\\)/g, (match, equation) => {
    try {
      return katex.renderToString(equation.trim(), {
        displayMode: false,
        throwOnError: false,
      })
    } catch {
      return match
    }
  })

  return processed
}

// 2. 代码块高亮与增强处理
function formatCodeBlocks(rawHtml: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = rawHtml

  const preElements = tempDiv.querySelectorAll('pre')
  preElements.forEach((pre, index) => {
    const codeEl = pre.querySelector('code')
    if (!codeEl) return

    let lang = 'code'
    const classList = Array.from(codeEl.classList)
    const langClass = classList.find((cls) => cls.startsWith('language-'))
    if (langClass) {
      lang = langClass.replace('language-', '')
    }

    const rawCode = codeEl.textContent || ''
    if (lang && hljs.getLanguage(lang)) {
      try {
        codeEl.innerHTML = hljs.highlight(rawCode, { language: lang, ignoreIllegals: true }).value
      } catch {
        codeEl.innerHTML = hljs.highlightAuto(rawCode).value
      }
    } else {
      try {
        codeEl.innerHTML = hljs.highlightAuto(rawCode).value
      } catch {
        // 保留原样
      }
    }

    // 创建包装容器
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper my-3.5 rounded-xl overflow-hidden border border-outline-variant/30 bg-[#1e2022] shadow-xs'

    // 顶部状态栏
    const header = document.createElement('div')
    header.className = 'flex items-center justify-between px-3.5 py-1.5 bg-[#17181a] border-b border-white/5 text-[11px] font-mono text-zinc-400 select-none'

    const langSpan = document.createElement('span')
    langSpan.className = 'font-semibold lowercase text-zinc-400'
    langSpan.textContent = lang

    const copyBtn = document.createElement('button')
    copyBtn.className = 'copy-code-btn flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer'
    copyBtn.setAttribute('data-code', encodeURIComponent(rawCode))
    copyBtn.setAttribute('data-index', String(index))
    copyBtn.innerHTML = `
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>
      <span>复制</span>
    `

    header.appendChild(langSpan)
    header.appendChild(copyBtn)

    pre.className = 'p-3.5 overflow-x-auto text-[12px] font-mono leading-relaxed text-zinc-200 bg-transparent m-0'
    codeEl.className = 'font-mono'

    pre.parentNode?.replaceChild(wrapper, pre)
    wrapper.appendChild(header)
    wrapper.appendChild(pre)
  })

  return tempDiv.innerHTML
}

// 3. 汇总渲染
const renderedHtml = computed(() => {
  if (!props.content) return ''

  // 1. 流式未闭合补全
  const healedContent = autoCloseMarkdown(props.content, props.isStreaming)

  // 2. 处理 LaTeX 公式
  const withLatex = renderLatex(healedContent)

  // 3. Marked 解析 Markdown
  const rawHtml = marked.parse(withLatex) as string

  // 4. 增强代码块
  return formatCodeBlocks(rawHtml)
})

// 绑定一键复制事件
function attachCopyListeners() {
  if (!containerRef.value) return
  const buttons = containerRef.value.querySelectorAll('.copy-code-btn')
  buttons.forEach((btn) => {
    const button = btn as HTMLButtonElement
    button.onclick = (e) => {
      e.stopPropagation()
      const rawCode = decodeURIComponent(button.getAttribute('data-code') || '')
      if (!rawCode) return

      navigator.clipboard.writeText(rawCode).then(() => {
        const textSpan = button.querySelector('span')
        if (textSpan) {
          const originalText = textSpan.textContent
          textSpan.textContent = '已复制!'
          button.classList.add('text-emerald-400')
          setTimeout(() => {
            textSpan.textContent = originalText
            button.classList.remove('text-emerald-400')
          }, 2000)
        }
      })
    }
  })
}

watch(renderedHtml, () => {
  nextTick(() => attachCopyListeners())
})

onMounted(() => {
  nextTick(() => attachCopyListeners())
})
</script>

<template>
  <div class="ai-markdown-container text-on-surface font-body leading-relaxed">
    <div
      ref="containerRef"
      class="ai-markdown-content break-words text-[13px] sm:text-sm"
      v-html="renderedHtml"
    ></div>

    <!-- 流式生成呼吸光标 -->
    <span
      v-if="isStreaming"
      class="inline-block w-1.5 h-4 ml-1 bg-primary align-middle animate-pulse rounded-xs"
      aria-hidden="true"
    ></span>
  </div>
</template>

<style>
/* Markdown 排版深度优化，与 M3 审美体系融合 */
.ai-markdown-content {
  font-family: 'Plus Jakarta Sans', 'Nunito Sans', sans-serif;
  line-height: 1.75;
}

.ai-markdown-content p {
  margin-top: 0.6rem;
  margin-bottom: 0.6rem;
}

.ai-markdown-content p:first-child {
  margin-top: 0;
}

.ai-markdown-content p:last-child {
  margin-bottom: 0;
}

.ai-markdown-content h1,
.ai-markdown-content h2,
.ai-markdown-content h3,
.ai-markdown-content h4,
.ai-markdown-content h5,
.ai-markdown-content h6 {
  font-family: 'Noto Serif', 'Literata', serif;
  font-weight: 700;
  color: var(--color-primary);
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  line-height: 1.35;
}

.ai-markdown-content h1 { font-size: 1.3rem; }
.ai-markdown-content h2 { font-size: 1.18rem; }
.ai-markdown-content h3 { font-size: 1.08rem; }
.ai-markdown-content h4 { font-size: 0.98rem; }

.ai-markdown-content ul {
  list-style-type: disc;
  padding-left: 1.3rem;
  margin-top: 0.4rem;
  margin-bottom: 0.4rem;
}

.ai-markdown-content ol {
  list-style-type: decimal;
  padding-left: 1.3rem;
  margin-top: 0.4rem;
  margin-bottom: 0.4rem;
}

.ai-markdown-content li {
  margin-top: 0.25rem;
  margin-bottom: 0.25rem;
}

.ai-markdown-content blockquote {
  border-left: 3.5px solid var(--color-primary);
  background: var(--color-surface-container-low);
  padding: 0.6rem 0.95rem;
  margin: 0.75rem 0;
  border-radius: 0 0.6rem 0.6rem 0;
  color: var(--color-on-surface-variant);
  font-style: normal;
}

.ai-markdown-content hr {
  border: 0;
  border-top: 1px solid rgba(193, 200, 199, 0.4);
  margin: 1.1rem 0;
}

/* 行内代码 */
.ai-markdown-content :not(pre) > code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.84em;
  background-color: var(--color-surface-container-high);
  color: var(--color-primary);
  padding: 0.15rem 0.38rem;
  border-radius: 0.375rem;
  font-weight: 500;
  border: 1px solid rgba(193, 200, 199, 0.3);
}

/* 表格排版 */
.ai-markdown-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.85rem 0;
  font-size: 0.84rem;
  border-radius: 0.5rem;
  overflow: hidden;
}

.ai-markdown-content th,
.ai-markdown-content td {
  border: 1px solid rgba(193, 200, 199, 0.4);
  padding: 0.45rem 0.8rem;
  text-align: left;
}

.ai-markdown-content th {
  background-color: var(--color-surface-container);
  font-weight: 600;
  color: var(--color-on-surface);
}

.ai-markdown-content tr:nth-child(even) {
  background-color: var(--color-surface-container-low);
}

/* KaTeX 渲染微调 */
.katex-display {
  margin: 0.6em 0 !important;
  overflow-x: auto;
  overflow-y: hidden;
}

.katex {
  font-size: 1.08em;
}
</style>
