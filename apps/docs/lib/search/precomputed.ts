import 'server-only'
import type { SearchIndex, SearchPage } from '@/lib/search/types'
import { searchCatalogHash } from '@/lib/search/utils'
import generatedIndex from '@/.content/search.json'
import generatedCatalog from '@/.content/search-catalog.json'

const index = generatedIndex as SearchIndex
const pages = generatedCatalog as SearchPage[]
const pagesByUrl = new Map(pages.map((page) => [page.url, page]))
if (index.version !== 1 || index.catalogHash !== searchCatalogHash(pages))
  throw new Error('Search index does not match the documentation catalog. Run content:generate.')

/** An immutable server-only index, generated and published with the canonical catalog. */
export function getSearchIndex() {
  return index.entries
}

export function getSearchPage(path: string) {
  return pagesByUrl.get(path)
}
