'use client'

import { Chip } from '@sim/emcn'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

interface SettingsListPaginationProps {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  error: Error | null
  fetchNextPage: () => Promise<unknown>
  /** Shown when the next page fails to load, beside a retry. */
  fallback: string
}

/** Loads the next page of a cursor-paginated list, with a retry when a page fails. */
export function SettingsListPagination({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  error,
  fetchNextPage,
  fallback,
}: SettingsListPaginationProps) {
  if (isFetchNextPageError)
    return (
      <SettingsQueryErrorState
        error={error}
        fallback={fallback}
        isRetrying={isFetchingNextPage}
        onRetry={() => void fetchNextPage()}
        variant='inline'
      />
    )
  if (!hasNextPage) return null
  return (
    <div className='flex justify-center'>
      <Chip disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
        {isFetchingNextPage ? 'Loading' : 'Load more'}
      </Chip>
    </div>
  )
}
