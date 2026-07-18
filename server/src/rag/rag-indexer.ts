import { createHash } from 'node:crypto'
import type { RagChunk } from './rag.model'
import type { EmbeddingProvider } from './local-embedding.provider'
import { termFrequency, tokenizeText } from './local-embedding.provider'
import { PromptInjectionScanner } from './prompt-injection-scanner'

const TARGET_CHUNK_CHARS = 850
const MIN_CHUNK_CHARS = 420
const CHUNK_OVERLAP_CHARS = 100

type ChunkDraft = { heading: string; text: string; startOffset: number; endOffset: number }

export class RagIndexer {
  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly injectionScanner: PromptInjectionScanner
  ) {}

  index(documentId: string, content: string, previousChunks: RagChunk[] = []) {
    const previousByHash = new Map(previousChunks.map((chunk) => [chunk.contentHash, chunk]))
    const seenHashes = new Set<string>()
    const chunks: RagChunk[] = []

    for (const draft of splitContent(content)) {
      const contentHash = digest(draft.text)
      if (seenHashes.has(contentHash)) continue
      seenHashes.add(contentHash)
      const tokens = tokenizeText(draft.text)
      const findings = this.injectionScanner.scan(draft.text)
      const previous = previousByHash.get(contentHash)
      chunks.push({
        id: digest(`${documentId}\0${contentHash}`).slice(0, 32),
        documentId,
        index: chunks.length,
        heading: draft.heading.slice(0, 300),
        text: draft.text,
        startOffset: draft.startOffset,
        endOffset: draft.endOffset,
        contentHash,
        terms: termFrequency(tokens),
        tokenCount: tokens.length,
        vector: previous?.vector || this.embeddingProvider.embed(draft.text),
        injectionRisk: this.injectionScanner.risk(findings),
        injectionSignals: [...new Set(findings.map((finding) => finding.message))].slice(0, 10)
      })
    }
    return chunks
  }
}

export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function splitContent(source: string) {
  const content = source.replace(/\r\n?/g, '\n')
  const headings = [...content.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)]
  const sections: Array<{ heading: string; start: number; end: number }> = []
  let cursor = 0
  let heading = ''

  for (const match of headings) {
    const headingStart = match.index || 0
    if (headingStart > cursor) sections.push({ heading, start: cursor, end: headingStart })
    heading = match[1].trim()
    cursor = headingStart + match[0].length
  }
  if (cursor < content.length) sections.push({ heading, start: cursor, end: content.length })
  if (!sections.length && content.trim()) sections.push({ heading: '', start: 0, end: content.length })

  const chunks: ChunkDraft[] = []
  for (const section of sections) chunks.push(...splitSection(content, section.heading, section.start, section.end))
  return chunks
}

function splitSection(content: string, heading: string, sectionStart: number, sectionEnd: number) {
  const chunks: ChunkDraft[] = []
  let cursor = skipWhitespace(content, sectionStart, sectionEnd)
  while (cursor < sectionEnd) {
    const maximumEnd = Math.min(sectionEnd, cursor + TARGET_CHUNK_CHARS)
    const end = maximumEnd < sectionEnd ? findBreak(content, cursor, maximumEnd) : sectionEnd
    const raw = content.slice(cursor, end).trim()
    if (raw) {
      const text = heading ? `# ${heading}\n${raw}` : raw
      chunks.push({ heading, text, startOffset: cursor, endOffset: end })
    }
    if (end >= sectionEnd) break
    const next = Math.max(cursor + 1, end - CHUNK_OVERLAP_CHARS)
    cursor = skipWhitespace(content, next, sectionEnd)
  }
  return chunks
}

function findBreak(content: string, start: number, maximumEnd: number) {
  const minimumEnd = Math.min(maximumEnd, start + MIN_CHUNK_CHARS)
  for (let index = maximumEnd; index > minimumEnd; index -= 1) {
    const character = content[index - 1]
    if (character === '\n' || character === '。' || character === '！' || character === '？' || character === '.' || character === '!' || character === '?') return index
  }
  return maximumEnd
}

function skipWhitespace(content: string, start: number, end: number) {
  let cursor = start
  while (cursor < end && /\s/.test(content[cursor])) cursor += 1
  return cursor
}
