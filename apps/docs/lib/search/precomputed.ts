import 'server-only'
import { getPages } from '@/lib/content/catalog'
import type { SearchIndex } from '@/lib/search/types'
import { searchCatalogHash } from '@/lib/search/utils'
import generatedIndex from '@/.content/search.json'

const index = generatedIndex as SearchIndex
if (index.version !== 1 || index.catalogHash !== searchCatalogHash(getPages()))
  throw new Error('Search index does not match the documentation catalog. Run content:generate.')

/** An immutable server-only index, generated and published with the canonical catalog. */
export function getSearchIndex() {
  return index.entries
}
