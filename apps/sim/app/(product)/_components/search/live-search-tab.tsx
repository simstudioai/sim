'use client'

import { SearchResults } from '@/app/(product)/_components/search/search-results'
import type { PlatformResource } from '@/platform/lib/data/models/chat'
import { useSearchTabResults } from '@/platform/lib/data/search'

export function LiveSearchTab({ resource }: { resource: PlatformResource }) {
  return <SearchResults results={useSearchTabResults(resource)} />
}
