import { compareStrings } from '@sim/utils/string'
import { z } from 'zod'
import { getPage, getPages } from '@/lib/content/catalog'
import type { DocsPage } from '@/lib/content/types'
import { DOCS_BASE_URL } from '@/lib/urls'

export const pagePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^\/(?:[A-Za-z0-9_-]+\/?)*$/, 'Use a canonical documentation path beginning with /')

export const listPagesSchema = z.object({
  section: z.enum(['docs', 'api', 'cli', 'mcp']).optional(),
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(100).default(25),
})

function pageMetadata(page: DocsPage) {
  return {
    id: page.id,
    path: page.url,
    url: new URL(page.url, DOCS_BASE_URL).href,
    title: page.title,
    description: page.description,
    section: page.section,
    contentHash: page.contentHash,
    ...(page.lastModified ? { lastModified: page.lastModified } : {}),
  }
}

/** Pages are ordered by canonical path; cursors name the last returned page. */
export function listPages(input: z.input<typeof listPagesSchema>) {
  const { section, cursor, limit } = listPagesSchema.parse(input)
  const pages = getPages()
    .filter((page) => page.url !== '/' && (!section || page.section === section))
    .sort((left, right) => compareStrings(left.url, right.url))
  const cursorIndex = cursor ? pages.findIndex((page) => page.id === cursor) : -1
  if (cursor && cursorIndex === -1) throw new Error('Unknown page cursor')
  const selected = pages.slice(cursorIndex + 1, cursorIndex + 1 + limit)
  return {
    pages: selected.map(pageMetadata),
    nextCursor:
      cursorIndex + 1 + selected.length < pages.length ? (selected.at(-1)?.id ?? null) : null,
    total: pages.length,
  }
}

/** Catalog lookup is the entire read boundary: no caller-supplied URL is fetched. */
export function readPage(path: string) {
  const parsed = pagePathSchema.parse(path)
  const page = getPage(parsed)
  if (!page || page.url === '/') return null
  return { ...pageMetadata(page), headings: page.headings, markdown: page.markdown }
}
