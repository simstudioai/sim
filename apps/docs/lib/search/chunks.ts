import type { Code, RootContent } from 'mdast'
import { toString as markdownToString } from 'mdast-util-to-string'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { DocsHeading, DocsPage } from '@/lib/content/types'
import type { SearchChunk } from '@/lib/search/types'
import { DOCS_BASE_URL } from '@/lib/urls'

const CHUNK_CHARACTERS = 6000
const parser = unified().use(remarkParse)

function splitText(value: string, limit: number, location: string): string[] {
  const parts: string[] = []
  let rest = value
  while (rest.length > limit) {
    const boundary = Math.max(rest.lastIndexOf(' ', limit), rest.lastIndexOf('\n', limit))
    if (boundary <= 0) throw new Error(`${location}: unbreakable text exceeds search chunk budget`)
    parts.push(rest.slice(0, boundary).trimEnd())
    rest = rest.slice(boundary).trimStart()
  }
  if (rest || !parts.length) parts.push(rest)
  return parts
}

function packLines(lines: string[], limit: number, location: string): string[] {
  const parts: string[] = []
  let current: string[] = []
  let length = 0
  for (const line of lines) {
    if (line.length > limit) throw new Error(`${location}: a code line exceeds search chunk budget`)
    if (current.length && length + 1 + line.length > limit) {
      parts.push(current.join('\n'))
      current = []
      length = 0
    }
    length += line.length + (current.length ? 1 : 0)
    current.push(line)
  }
  if (current.length) parts.push(current.join('\n'))
  return parts
}

function excerptLabel(kind: string, index: number, total: number) {
  return `${kind} excerpt (part ${index} of ${total}; continued).\n\n`
}

function codeParts(node: Code, raw: string, limit: number, location: string) {
  const opening = /^ {0,3}(`{3,}|~{3,})([^\n]*)/.exec(raw)
  const marker = opening?.[1] ?? '```'
  const opener = opening ? `${marker}${opening[2]}` : marker
  const labelBudget = excerptLabel('Code', raw.length, raw.length).length
  const parts = packLines(
    node.value.split('\n'),
    limit - opener.length - marker.length - labelBudget - 2,
    location
  )
  return parts.map(
    (part, index) => `${excerptLabel('Code', index + 1, parts.length)}${opener}\n${part}\n${marker}`
  )
}

function tableCells(row: string) {
  const cells: string[] = []
  let current = ''
  let escapes = 0
  for (const character of row.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (character === '|' && escapes % 2 === 0) {
      cells.push(current.trim())
      current = ''
    } else current += character
    escapes = character === '\\' ? escapes + 1 : 0
  }
  cells.push(current.trim())
  return cells
}

function tableParts(raw: string, limit: number, location: string) {
  const [header, separator, ...rows] = raw.split('\n')
  const prefix = `${header}\n${separator}\n`
  const rowBudget = limit - prefix.length - excerptLabel('Table', raw.length, raw.length).length
  if (rowBudget < 100) throw new Error(`${location}: table header exceeds search chunk budget`)
  const expanded = rows.flatMap((row) => {
    if (row.length <= rowBudget) return [row]
    const cells = tableCells(row)
    const cellBudget = Math.floor((rowBudget - 3 * cells.length - 1) / cells.length)
    if (cellBudget < 1) throw new Error(`${location}: table columns exceed search chunk budget`)
    const fragments = cells.map((cell) => splitText(cell, cellBudget, location))
    return Array.from(
      { length: Math.max(...fragments.map((parts) => parts.length)) },
      (_, index) =>
        `| ${fragments.map((parts) => parts[index] ?? (parts.length === 1 ? parts[0] : '')).join(' | ')} |`
    )
  })
  const parts = packLines(expanded, rowBudget, location)
  return parts.map(
    (part, index) => `${excerptLabel('Table', index + 1, parts.length)}${prefix}${part}`
  )
}

function blockParts(node: RootContent, raw: string, limit: number, location: string) {
  if (raw.length <= limit) return [raw]
  if (node.type === 'code') return codeParts(node, raw, limit, location)
  const lines = raw.split('\n')
  if (lines[0]?.includes('|') && /^[\s|:-]+$/.test(lines[1] ?? '') && lines[1]?.includes('-'))
    return tableParts(raw, limit, location)
  let nestedCode = false
  visit(node, 'code', () => {
    nestedCode = true
  })
  if (nestedCode)
    throw new Error(`${location}: oversized nested code requires a separate search block`)
  return splitText(raw, limit, location)
}

function sectionChunks(text: string, page: DocsPage, heading: DocsHeading): string[] {
  if (!text) return []
  if (text.length <= CHUNK_CHARACTERS) return [text]
  const context = `# ${page.title}\n\n${'#'.repeat(heading.depth)} ${heading.title} (continued)\n\n`
  const limit = CHUNK_CHARACTERS - context.length
  const location = `${page.url}${heading.id ? `#${heading.id}` : ''}`
  if (limit < 100) throw new Error(`${location}: heading context exceeds search chunk budget`)
  const chunks: string[] = []
  let current = ''
  const flush = () => {
    if (current) chunks.push(`${chunks.length ? context : ''}${current}`)
    current = ''
  }
  for (const node of parser.parse(text).children) {
    const raw = text.slice(node.position?.start.offset, node.position?.end.offset)
    for (const part of blockParts(node, raw, limit, location)) {
      if (current && current.length + 2 + part.length > limit) flush()
      current += `${current ? '\n\n' : ''}${part}`
    }
  }
  flush()
  return chunks
}

/** Chunk processed Markdown by AST headings, preserving catalog IDs rather than generating slugs. */
export function* pageSearchChunks(page: DocsPage): Generator<SearchChunk> {
  const headingsByTitle = new Map<string, DocsHeading[]>()
  for (const heading of page.headings) {
    const siblings = headingsByTitle.get(heading.title) ?? []
    siblings.push(heading)
    headingsByTitle.set(heading.title, siblings)
  }
  const sections: Array<{ heading: DocsHeading; offset: number; key: string }> = [
    { heading: { id: '', title: page.title, depth: 1 }, offset: 0, key: '' },
  ]
  visit(parser.parse(page.markdown), 'heading', (node) => {
    const rawTitle = markdownToString(node)
    const explicitId = /\s*\[#([^\]]+)\]\s*$/.exec(rawTitle)?.[1]
    const title = rawTitle.replace(/\s*\[#[^\]]+\]\s*$/, '').trim()
    const heading = explicitId
      ? page.headings.find((item) => item.id === explicitId)
      : headingsByTitle.get(title)?.shift()
    const offset = node.position?.start.offset
    if (offset === undefined) return
    if (heading) {
      sections.push({ heading, offset, key: heading.id })
    } else if (page.operation && node.depth > 1) {
      sections.push({
        heading: { id: '', title, depth: node.depth },
        offset,
        key: `markdown:${offset}`,
      })
    }
  })
  for (const [index, section] of sections.entries()) {
    const text = page.markdown.slice(section.offset, sections[index + 1]?.offset).trim()
    for (const [chunkIndex, chunk] of sectionChunks(text, page, section.heading).entries()) {
      yield {
        id: `${page.id}:${section.key}:${chunkIndex}`,
        pageId: page.id,
        sourceDocument: page.operation
          ? `${page.url.slice(1)}.mdx`
          : page.sourcePath.replace(/^content\/docs\//, ''),
        sourceLink: new URL(
          `${page.url}${section.heading.id ? `#${section.heading.id}` : ''}`,
          DOCS_BASE_URL
        ).href,
        headerText: section.heading.title,
        headerLevel: section.heading.depth,
        text: chunk,
        contentHash: page.contentHash,
        documentTitle: page.title,
      }
    }
  }
}
