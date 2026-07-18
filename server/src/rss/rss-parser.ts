import type { ParsedFeed } from './rss.model'

const MAX_XML_LENGTH = 2 * 1024 * 1024
const MAX_ITEMS_PER_FEED = 1_000

export function parseFeedXml(xmlInput: string): ParsedFeed {
  if (typeof xmlInput !== 'string' || !xmlInput.trim()) throw new Error('Feed body is empty')
  if (Buffer.byteLength(xmlInput, 'utf8') > MAX_XML_LENGTH) throw new Error('Feed body exceeds 2 MB')
  const xml = xmlInput.replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, '')
  if (/<feed\b/i.test(xml)) return parseAtom(xml)
  if (/<(?:rss|rdf:RDF)\b/i.test(xml)) return parseRss(xml)
  throw new Error('Unsupported feed format; expected RSS or Atom')
}

function parseRss(xml: string): ParsedFeed {
  const channel = firstBlock(xml, 'channel') || xml
  const blocks = allBlocks(channel, 'item').slice(0, MAX_ITEMS_PER_FEED)
  return {
    title: tagText(channel, ['title']) || 'Untitled RSS feed',
    siteUrl: normalizeHttpUrl(tagText(channel, ['link'])),
    description: plainText(tagText(channel, ['description', 'subtitle'])).slice(0, 2_000),
    items: blocks.map((block) => ({
      guid: tagText(block, ['guid', 'id']) || tagText(block, ['link']) || fingerprintFallback(block),
      title: plainText(tagText(block, ['title'])) || 'Untitled item',
      link: normalizeHttpUrl(tagText(block, ['link'])),
      author: plainText(tagText(block, ['author', 'dc:creator', 'creator'])).slice(0, 300) || undefined,
      summary: plainText(tagText(block, ['description', 'summary'])).slice(0, 4_000),
      content: plainText(tagText(block, ['content:encoded', 'encoded', 'description'])).slice(0, 200_000),
      publishedAt: parseDate(tagText(block, ['pubDate', 'dc:date', 'date'])),
      updatedAt: parseDate(tagText(block, ['updated', 'dc:date'])),
      enclosure: parseEnclosure(block)
    }))
  }
}

function parseAtom(xml: string): ParsedFeed {
  const blocks = allBlocks(xml, 'entry').slice(0, MAX_ITEMS_PER_FEED)
  return {
    title: plainText(tagText(xml, ['title'])) || 'Untitled Atom feed',
    siteUrl: atomLink(xml, 'alternate'),
    description: plainText(tagText(xml, ['subtitle'])).slice(0, 2_000),
    items: blocks.map((block) => ({
      guid: tagText(block, ['id']) || atomLink(block, 'alternate') || fingerprintFallback(block),
      title: plainText(tagText(block, ['title'])) || 'Untitled item',
      link: atomLink(block, 'alternate'),
      author: plainText(firstBlock(block, 'author') ? tagText(firstBlock(block, 'author')!, ['name']) : '').slice(0, 300) || undefined,
      summary: plainText(tagText(block, ['summary'])).slice(0, 4_000),
      content: plainText(tagText(block, ['content', 'summary'])).slice(0, 200_000),
      publishedAt: parseDate(tagText(block, ['published', 'issued'])),
      updatedAt: parseDate(tagText(block, ['updated', 'modified'])),
      enclosure: parseAtomEnclosure(block)
    }))
  }
}

function allBlocks(xml: string, tag: string) {
  const escaped = escapeRegex(tag)
  const pattern = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'gi')
  return Array.from(xml.matchAll(pattern), (match) => match[0])
}

function firstBlock(xml: string, tag: string) {
  return allBlocks(xml, tag)[0]
}

function tagText(xml: string, tags: string[]) {
  for (const tag of tags) {
    const escaped = escapeRegex(tag)
    const pair = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i').exec(xml)
    if (pair) return decodeXml(stripCdata(pair[1]).trim())
  }
  return ''
}

function atomLink(xml: string, preferredRel: string) {
  const links = Array.from(xml.matchAll(/<link\b([^>]*?)(?:\/>|>\s*<\/link>)/gi))
  const preferred = links.find((match) => (attribute(match[1], 'rel') || 'alternate') === preferredRel) || links[0]
  return preferred ? normalizeHttpUrl(attribute(preferred[1], 'href')) : undefined
}

function parseEnclosure(xml: string) {
  const match = /<enclosure\b([^>]*?)(?:\/>|>)/i.exec(xml)
  if (!match) return undefined
  const url = normalizeHttpUrl(attribute(match[1], 'url'))
  if (!url) return undefined
  const length = Number(attribute(match[1], 'length'))
  return { url, type: attribute(match[1], 'type') || undefined, length: Number.isFinite(length) ? length : undefined }
}

function parseAtomEnclosure(xml: string) {
  const links = Array.from(xml.matchAll(/<link\b([^>]*?)(?:\/>|>\s*<\/link>)/gi))
  const match = links.find((item) => attribute(item[1], 'rel') === 'enclosure')
  if (!match) return undefined
  const url = normalizeHttpUrl(attribute(match[1], 'href'))
  if (!url) return undefined
  const length = Number(attribute(match[1], 'length'))
  return { url, type: attribute(match[1], 'type') || undefined, length: Number.isFinite(length) ? length : undefined }
}

function attribute(value: string, name: string) {
  const match = new RegExp(`\\b${escapeRegex(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(value)
  return decodeXml(match?.[1] ?? match?.[2] ?? '')
}

function plainText(value: string) {
  return decodeXml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => safeCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function safeCodePoint(value: number) {
  try { return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '' } catch { return '' }
}

function stripCdata(value: string) {
  const match = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value)
  return match ? match[1] : value
}

function parseDate(value: string) {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function normalizeHttpUrl(value: string) {
  if (!value) return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch { return undefined }
}

function fingerprintFallback(value: string) {
  return plainText(value).slice(0, 500)
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
