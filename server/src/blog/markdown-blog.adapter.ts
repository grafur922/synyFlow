import { ConflictException, ServiceUnavailableException } from '@nestjs/common'
import { lstat, mkdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { BlogDraft } from './blog.model'

export class MarkdownBlogAdapter {
  private readonly configuredPath = (process.env.TERRA_BLOG_CONTENT_DIR || '').trim()

  getStatus() {
    return {
      type: 'markdown-directory',
      configured: Boolean(this.configuredPath),
      directoryName: this.configuredPath ? basename(resolve(this.configuredPath)) : undefined,
      message: this.configuredPath ? 'Markdown 博客目录已配置' : '请配置 TERRA_BLOG_CONTENT_DIR'
    }
  }

  async publish(draft: BlogDraft) {
    const base = await this.resolveBase()
    const target = this.resolveTarget(base, `${draft.slug}.md`)
    if (draft.publishedPath && draft.publishedPath !== `${draft.slug}.md`) {
      const existingTarget = await exists(target)
      if (existingTarget) throw new ConflictException('新 slug 对应的文章文件已存在')
    }
    await this.assertSafeTarget(target)
    await this.atomicWrite(target, this.renderMarkdown(draft))

    if (draft.publishedPath && draft.publishedPath !== `${draft.slug}.md`) {
      await this.moveToTrash(base, draft.publishedPath)
    }
    return { relativePath: relative(base, target).replace(/\\/g, '/') }
  }

  async withdraw(draft: BlogDraft) {
    if (!draft.publishedPath) return { withdrawn: false }
    const base = await this.resolveBase()
    const movedTo = await this.moveToTrash(base, draft.publishedPath)
    return { withdrawn: Boolean(movedTo), trashPath: movedTo }
  }

  preview(draft: BlogDraft) {
    return {
      markdown: this.renderMarkdown(draft),
      html: renderSafeMarkdown(draft.content)
    }
  }

  private async resolveBase() {
    if (!this.configuredPath) throw new ServiceUnavailableException('博客 Markdown 目录未配置')
    const requested = resolve(this.configuredPath)
    await mkdir(requested, { recursive: true })
    return realpath(requested)
  }

  private resolveTarget(base: string, relativePath: string) {
    const target = resolve(base, relativePath)
    if (target !== base && !target.startsWith(`${base}${sep}`)) throw new ConflictException('博客目标路径越界')
    return target
  }

  private async assertSafeTarget(target: string) {
    try {
      const info = await lstat(target)
      if (info.isSymbolicLink()) throw new ConflictException('不允许发布到符号链接')
      if (!info.isFile()) throw new ConflictException('博客目标不是普通文件')
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
  }

  private async atomicWrite(target: string, content: string) {
    const temp = `${target}.terra-tmp-${process.pid}-${Date.now()}`
    const backup = `${target}.terra-bak`
    await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
    await rm(backup, { force: true }).catch(() => undefined)
    let hadOriginal = false
    try {
      await stat(target)
      await rename(target, backup)
      hadOriginal = true
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        await rm(temp, { force: true }).catch(() => undefined)
        throw error
      }
    }
    try {
      await rename(temp, target)
      await rm(backup, { force: true }).catch(() => undefined)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      if (hadOriginal) await rename(backup, target).catch(() => undefined)
      throw error
    }
  }

  private async moveToTrash(base: string, publishedPath: string) {
    const source = this.resolveTarget(base, publishedPath)
    try {
      const info = await lstat(source)
      if (info.isSymbolicLink() || !info.isFile()) throw new ConflictException('已发布文章路径不安全')
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined
      throw error
    }
    const trash = this.resolveTarget(base, '.terra-trash')
    await mkdir(trash, { recursive: true })
    const target = this.resolveTarget(trash, `${Date.now()}-${basename(source)}`)
    await rename(source, target)
    return relative(base, target).replace(/\\/g, '/')
  }

  private renderMarkdown(draft: BlogDraft) {
    const frontmatter = [
      '---',
      `title: ${yamlString(draft.title)}`,
      `slug: ${yamlString(draft.slug)}`,
      `date: ${yamlString(new Date(draft.publishedAt || Date.now()).toISOString())}`,
      `updated: ${yamlString(new Date(draft.updatedAt).toISOString())}`,
      `draft: false`,
      `tags: [${draft.tags.map(yamlString).join(', ')}]`,
      `terra_id: ${yamlString(draft.id)}`,
      draft.excerpt ? `description: ${yamlString(draft.excerpt)}` : '',
      '---',
      '',
      draft.content.trimEnd(),
      ''
    ].filter((line) => line !== '')
    return `${frontmatter.join('\n')}\n`
  }
}

async function exists(path: string) {
  try { await stat(path); return true } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return false; throw error }
}

function yamlString(value: string) {
  return JSON.stringify(value.replace(/[\r\n]+/g, ' ').trim())
}

function renderSafeMarkdown(markdown: string) {
  const escaped = escapeHtml(markdown)
  const lines = escaped.split('\n')
  const html = lines.map((line) => {
    if (/^###\s+/.test(line)) return `<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`
    if (/^##\s+/.test(line)) return `<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`
    if (/^#\s+/.test(line)) return `<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`
    if (/^[-*]\s+/.test(line)) return `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`
    if (!line.trim()) return ''
    return `<p>${inline(line)}</p>`
  }).join('\n')
  return html.replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, (list) => `<ul>${list}</ul>`)
}

function inline(value: string) {
  return value
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
