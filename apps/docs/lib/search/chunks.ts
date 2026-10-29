import { toString as markdownToString } from 'mdast-util-to-string'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { DocsHeading, DocsPage } from '@/lib/content/types'
import type { SearchChunk } from '@/lib/search/types'
import { DOCS_BASE_URL } from '@/lib/urls'

const CHUNK_CHARACTERS = 6000
const parser = unified().use(remarkParse)

/** Chunk processed Markdown by AST headings, preserving catalog IDs rather than generating slugs. */
export function* pageSearchChunks(page: DocsPage): Generator<SearchChunk> {
  const headingsByTitle = new Map<string, DocsHeading[]>()
  for (const heading of page.headings) {
    const siblings = headingsByTitle.get(heading.title) ?? []
    siblings.push(heading)
    headingsByTitle.set(heading.title, siblings)
  }
  const sections: Array<{ heading: DocsHeading; offset: number }> = [
    { heading: { id: '', title: page.title, depth: 1 }, offset: 0 },
  ]
  visit(parser.parse(page.markdown), 'heading', (node) => {
    const rawTitle = markdownToString(node)
    const explicitId = /\s*\[#([^\]]+)\]\s*$/.exec(rawTitle)?.[1]
    const title = rawTitle.replace(/\s*\[#[^\]]+\]\s*$/, '').trim()
    const heading = explicitId
      ? page.headings.find((item) => item.id === explicitId)
      : headingsByTitle.get(title)?.shift()
    if (heading && node.position?.start.offset !== undefined) {
      sections.push({ heading, offset: node.position.start.offset })
    }
  })
  for (const [index, section] of sections.entries()) {
    const text = page.markdown.slice(section.offset, sections[index + 1]?.offset).trim()
    for (let offset = 0; offset < text.length; offset += CHUNK_CHARACTERS) {
      yield {
        id: `${page.id}:${section.heading.id}:${offset / CHUNK_CHARACTERS}`,
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
        text: text.slice(offset, offset + CHUNK_CHARACTERS),
        contentHash: page.contentHash,
        documentTitle: page.title,
      }
    }
  }
}
