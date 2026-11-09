'use client'

import type { PlatformResource } from '@/app/(product)/_components/chat/model'
import { SearchResults } from '@/app/(product)/_components/search/search-results'
import { useSearchTabResults } from '@/platform/lib/data/search'

export function LiveSearchTab({ resource }: { resource: PlatformResource }) {
  return <SearchResults results={useSearchTabResults(resource)} />
}
