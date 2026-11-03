import type { DocsPage } from '@/lib/content/types'
import { pageSearchChunks } from '@/lib/search/chunks'
import type { SearchIndex } from '@/lib/search/types'
import { normalizeSearchText, searchCatalogHash } from '@/lib/search/utils'

const MAX_SEARCH_INDEX_BYTES = 64 * 1024 * 1024

/** Build-time parsing keeps the public search cold path independent of corpus Markdown size. */
export function buildSearchIndex(pages: DocsPage[]): SearchIndex {
  const index: SearchIndex = { version: 1, catalogHash: searchCatalogHash(pages), entries: [] }
  let bytes = 0
  for (const page of pages) {
    if (page.url === '/') continue
    const title = normalizeSearchText(page.title)
    for (const chunk of pageSearchChunks(page)) {
      const entry = {
        chunk: {
          id: chunk.id,
          pageId: chunk.pageId,
          sourceLink: chunk.sourceLink,
          headerText: chunk.headerText,
        },
        body: normalizeSearchText(chunk.text),
        heading: normalizeSearchText(chunk.headerText),
        title,
      }
      bytes += Buffer.byteLength(JSON.stringify(entry)) + 1
      if (bytes > MAX_SEARCH_INDEX_BYTES - 1024)
        throw new Error('Generated search index exceeds the 64 MiB size budget')
      index.entries.push(entry)
    }
  }
  if (!index.entries.length) throw new Error('Generated search index is empty')
  return index
}
