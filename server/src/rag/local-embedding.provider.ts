import { createHash } from 'node:crypto'
import type { SparseEmbedding } from './rag.model'

export interface EmbeddingProvider {
  readonly id: string
  readonly dimensions: number
  readonly local: boolean
  embed(text: string): SparseEmbedding
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'with',
  '一个', '以及', '这个', '那个', '可以', '因为', '所以', '但是', '我们', '你们', '他们', '进行', '使用', '通过', '没有', '不是'
])

export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local-hash-v1'
  readonly dimensions = 512
  readonly local = true

  embed(text: string) {
    const counts = termFrequency(tokenizeText(text))
    const values = new Map<number, number>()
    for (const [token, count] of Object.entries(counts)) {
      const hash = createHash('sha256').update(token).digest()
      const index = hash.readUInt32BE(0) % this.dimensions
      const sign = hash[4] % 2 === 0 ? 1 : -1
      values.set(index, (values.get(index) || 0) + sign * (1 + Math.log(count)))
    }
    const norm = Math.sqrt([...values.values()].reduce((sum, value) => sum + value * value, 0)) || 1
    return [...values.entries()].map(([index, value]) => [index, round(value / norm, 8)] as [number, number]).sort((a, b) => a[0] - b[0])
  }
}

export function tokenizeText(text: string) {
  const normalized = String(text || '').normalize('NFKC').toLocaleLowerCase('zh-CN')
  const tokens: string[] = []
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)) {
    const value = match[0]
    if (/^\p{Script=Han}+$/u.test(value)) {
      const characters = [...value]
      for (const character of characters) if (!STOP_WORDS.has(character)) tokens.push(character)
      for (let index = 0; index < characters.length - 1; index += 1) {
        const bigram = `${characters[index]}${characters[index + 1]}`
        if (!STOP_WORDS.has(bigram)) tokens.push(bigram, bigram)
      }
    } else if ((value.length > 1 || /^\d+$/.test(value)) && !STOP_WORDS.has(value)) {
      tokens.push(value)
    }
  }
  return tokens.slice(0, 20_000)
}

export function termFrequency(tokens: string[]) {
  const result: Record<string, number> = Object.create(null) as Record<string, number>
  for (const token of tokens) result[token] = (result[token] || 0) + 1
  return result
}

export function cosineSimilarity(left: SparseEmbedding, right: SparseEmbedding) {
  let leftIndex = 0
  let rightIndex = 0
  let result = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex][0] === right[rightIndex][0]) {
      result += left[leftIndex][1] * right[rightIndex][1]
      leftIndex += 1
      rightIndex += 1
    } else if (left[leftIndex][0] < right[rightIndex][0]) leftIndex += 1
    else rightIndex += 1
  }
  return Math.max(-1, Math.min(1, result))
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}
