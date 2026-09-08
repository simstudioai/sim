'use client'

import { Chip } from '@sim/emcn'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

interface SearchSourcePaginationProps {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  error: Error | null
  fetchNextPage: () => Promise<unknown>
}

/** Sparse filtered pages remain navigable until the server reaches the end of the source list. */
export function SearchSourcePagination({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  error,
  fetchNextPage,
}: SearchSourcePaginationProps) {
  if (isFetchNextPageError)
    return (
      <SettingsQueryErrorState
        error={error}
        fallback='Could not load more sources'
        isRetrying={isFetchingNextPage}
        onRetry={() => void fetchNextPage()}
        variant='inline'
      />
    )
  if (!hasNextPage) return null
  return (
    <div className='flex justify-center'>
      <Chip disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
        {isFetchingNextPage ? 'Loading…' : 'Load more'}
      </Chip>
    </div>
  )
}
