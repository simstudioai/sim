'use client'

import { Chip, ChipDropdown, ChipInput, ChipLink, Skeleton } from '@sim/emcn'
import { RefreshCw, Search, SquareArrowUpRight } from '@sim/emcn/icons'
import type { ConnectorDocumentFilter } from '@/lib/api/contracts/knowledge/connectors'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  useConnectorDocuments,
  useExcludeConnectorDocument,
  useRestoreConnectorDocument,
} from '@/hooks/queries/kb/connectors'
import { useUpdateDocument } from '@/hooks/queries/kb/knowledge'

interface ConnectorDocumentsProps {
  knowledgeBaseId: string
  connectorId: string
  search?: string
  searchControl?: { value: string; onChange: (value: string) => void }
  progressScope?: ResourceScope
  isSearchIndex?: boolean
  syncing?: boolean
  filter: ConnectorDocumentFilter
  onFilterChange: (filter: ConnectorDocumentFilter) => void
}

export function ConnectorDocuments({
  knowledgeBaseId,
  connectorId,
  filter,
  search,
  searchControl,
  progressScope,
  isSearchIndex = false,
  syncing,
  onFilterChange,
}: ConnectorDocumentsProps) {
  const query = useConnectorDocuments(knowledgeBaseId, connectorId, {
    filter,
    search,
    progressScope,
    syncing,
  })
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const isLoading = query.isLoading || query.isPlaceholderData
  const excludeMutation = useExcludeConnectorDocument()
  const restoreMutation = useRestoreConnectorDocument()
  const retryMutation = useUpdateDocument()
  const mutationError = excludeMutation.error ?? restoreMutation.error ?? retryMutation.error
  const isRecoveryPending =
    excludeMutation.isPending || restoreMutation.isPending || retryMutation.isPending
  const documents = (data?.pages.flatMap((page) => page.documents) ?? []).filter((document) =>
    filter === 'excluded'
      ? document.userExcluded
      : !document.userExcluded && (filter !== 'failed' || document.processingStatus === 'failed')
  )
  const counts = data?.pages[0]?.counts ?? { active: 0, excluded: 0, failed: 0 }
  const visibleDocumentCount = counts[filter]
  const hasMoreVisibleDocuments = Boolean(hasNextPage && documents.length < visibleDocumentCount)

  function resetRecoveryErrors() {
    excludeMutation.reset()
    restoreMutation.reset()
    retryMutation.reset()
  }

  return (
    <>
      <div className='flex flex-col gap-4'>
        {isSearchIndex && (
          <p className='text-[var(--text-body)] text-sm'>Documents you can access</p>
        )}
        <div className='flex items-center gap-2'>
          {searchControl && (
            <ChipInput
              icon={Search}
              placeholder='Search documents...'
              value={searchControl.value}
              onChange={(event) => searchControl.onChange(event.target.value)}
              autoComplete='off'
              className='min-w-0 flex-1'
            />
          )}
          <ChipDropdown
            aria-label='Document status'
            value={filter}
            onChange={(value) => {
              if (value === 'active' || value === 'excluded' || value === 'failed')
                onFilterChange(value)
            }}
            matchTriggerWidth={false}
            options={[
              { value: 'active', label: isLoading ? 'Included' : `Included (${counts.active})` },
              {
                value: 'excluded',
                label: isLoading ? 'Excluded' : `Excluded (${counts.excluded})`,
              },
              { value: 'failed', label: isLoading ? 'Failed' : `Failed (${counts.failed})` },
            ]}
          />
        </div>
        <div className={RESOURCE_LIST_STACK}>
          {query.isError && !query.isFetchNextPageError ? (
            <SettingsQueryErrorState
              error={query.error}
              isRetrying={query.isFetching}
              onRetry={() => query.refetch()}
              fallback='Could not load documents'
              variant='inline'
            />
          ) : isLoading ? (
            <>
              <Skeleton className='h-10 w-full rounded-lg' />
              <Skeleton className='h-10 w-full rounded-lg' />
            </>
          ) : visibleDocumentCount === 0 ? (
            <SettingsEmptyState variant='inline'>
              {search?.trim()
                ? 'No documents match your search'
                : filter === 'excluded'
                  ? 'No excluded documents'
                  : filter === 'failed'
                    ? 'No failed documents'
                    : 'No documents yet'}
            </SettingsEmptyState>
          ) : (
            documents.map((doc) => (
              <SettingsResourceRow
                key={doc.id}
                title={doc.filename}
                description={
                  doc.processingStatus === 'failed'
                    ? 'Indexing failed'
                    : doc.processingStatus === 'pending'
                      ? 'Waiting to index'
                      : doc.processingStatus === 'processing'
                        ? 'Indexing'
                        : undefined
                }
                trailing={
                  <div className='flex items-center gap-2'>
                    {doc.sourceUrl && (
                      <ChipLink
                        href={doc.sourceUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                        leftIcon={SquareArrowUpRight}
                        aria-label={`Open ${doc.filename}`}
                      />
                    )}
                    {doc.processingStatus === 'failed' && !doc.userExcluded && (
                      <Chip
                        disabled={isRecoveryPending}
                        onClick={() => {
                          resetRecoveryErrors()
                          retryMutation.mutate({
                            knowledgeBaseId,
                            documentId: doc.id,
                            updates: { retryProcessing: true },
                          })
                        }}
                      >
                        Retry indexing
                      </Chip>
                    )}
                    <Chip
                      leftIcon={doc.userExcluded ? RefreshCw : undefined}
                      disabled={isRecoveryPending}
                      onClick={() => {
                        resetRecoveryErrors()
                        doc.userExcluded
                          ? restoreMutation.mutate({
                              knowledgeBaseId,
                              connectorId,
                              documentIds: [doc.id],
                            })
                          : excludeMutation.mutate({
                              knowledgeBaseId,
                              connectorId,
                              documentIds: [doc.id],
                            })
                      }}
                    >
                      {doc.userExcluded ? 'Restore' : 'Exclude'}
                    </Chip>
                  </div>
                }
              />
            ))
          )}
          {query.isFetchNextPageError ? (
            <SettingsQueryErrorState
              error={query.error}
              fallback='Could not load more documents'
              isRetrying={isFetchingNextPage}
              onRetry={() => void fetchNextPage()}
              variant='inline'
            />
          ) : !isLoading && hasMoreVisibleDocuments ? (
            <Chip disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {isFetchingNextPage ? 'Loading…' : 'Load more documents'}
            </Chip>
          ) : null}
        </div>
      </div>
      {mutationError && (
        <SettingsEmptyState variant='inline' tone='error'>
          {mutationError.message}
        </SettingsEmptyState>
      )}
    </>
  )
}
