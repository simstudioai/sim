'use client'

import { KnowledgeSearchResults } from '@/components/mothership-chat/knowledge-search-results'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { MothershipResource } from '@/lib/mothership/resources/types'

interface SearchResourceContentProps {
  resource: MothershipResource
  onSummarize: (message: string, filters: WorkspaceSearchFilters) => void
}

/** Search tabs store the query, then retrieve under the current reader's permissions. */
export function SearchResourceContent({ resource, onSummarize }: SearchResourceContentProps) {
  const search = resource.search
  if (!search) return null
  return (
    <div className='h-full overflow-y-auto px-4 py-3' aria-label='Search results'>
      <KnowledgeSearchResults
        scope={search.scope}
        query={search.query}
        filters={search.filters ?? {}}
        topK={search.topK}
        nativeQueries={search.nativeQueries}
        reuseFreshResult
        onSummarize={onSummarize}
      />
    </div>
  )
}
