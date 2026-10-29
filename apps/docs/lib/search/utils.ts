import { createHash } from 'node:crypto'
import { compareStrings } from '@sim/utils/string'
import type { DocsPage } from '@/lib/content/types'

export function normalizeSearchText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
}

/** Couples generated search data to exactly the catalog content it cites. */
export function searchCatalogHash(pages: DocsPage[]): string {
  const identities = pages
    .filter((page) => page.url !== '/')
    .map((page) => `${page.id}:${page.contentHash}`)
    .sort(compareStrings)
  return createHash('sha256').update(identities.join('\n')).digest('hex')
}
