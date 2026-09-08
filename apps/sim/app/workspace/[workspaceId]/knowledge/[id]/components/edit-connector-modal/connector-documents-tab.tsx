'use client'

import { useState } from 'react'
import {
  ButtonGroup,
  ButtonGroupItem,
  Chip,
  ChipLink,
  ChipModalError,
  ChipModalField,
  Skeleton,
} from '@sim/emcn'
import { RefreshCw, SquareArrowUpRight } from '@sim/emcn/icons'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  useConnectorDocuments,
  useExcludeConnectorDocument,
  useRestoreConnectorDocument,
} from '@/hooks/queries/kb/connectors'
import { useUpdateDocument } from '@/hooks/queries/kb/knowledge'

interface ConnectorDocumentsTabProps {
  knowledgeBaseId: string
  connectorId: string
}

export function ConnectorDocumentsTab({
  knowledgeBaseId,
  connectorId,
}: ConnectorDocumentsTabProps) {
  const [filter, setFilter] = useState<'active' | 'excluded' | 'failed'>('active')
  const query = useConnectorDocuments(knowledgeBaseId, connectorId, {
    includeExcluded: true,
    failedOnly: filter === 'failed',
  })
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = query
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

  if (isLoading) {
    return (
      <ChipModalField type='custom' title='Documents'>
        <Skeleton className='h-7 w-[180px] rounded-md' />
        <Skeleton className='h-[30px] w-full rounded-lg' />
        <Skeleton className='h-[30px] w-full rounded-lg' />
      </ChipModalField>
    )
  }
  if (query.isError) {
    return (
      <SettingsQueryErrorState
        error={query.error}
        isRetrying={query.isFetching}
        onRetry={() => query.refetch()}
        fallback='Could not load documents'
      />
    )
  }

  return (
    <>
      <ChipModalField type='custom' title='Documents'>
        <ButtonGroup
          value={filter}
          onValueChange={(value) => {
            if (value === 'active' || value === 'excluded' || value === 'failed') setFilter(value)
          }}
        >
          <ButtonGroupItem value='active'>Active ({counts.active})</ButtonGroupItem>
          <ButtonGroupItem value='excluded'>Excluded ({counts.excluded})</ButtonGroupItem>
          <ButtonGroupItem value='failed'>Failed ({counts.failed})</ButtonGroupItem>
        </ButtonGroup>
        <div>
          {visibleDocumentCount === 0 ? (
            <SettingsEmptyState variant='inline'>
              {filter === 'excluded'
                ? 'No excluded documents'
                : filter === 'failed'
                  ? 'No failed documents'
                  : 'No documents yet'}
            </SettingsEmptyState>
          ) : (
            documents.map((doc) => (
              <SettingsResourceRow
                key={doc.id}
                flush
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
          {hasMoreVisibleDocuments && (
            <Chip fullWidth disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {isFetchingNextPage ? 'Loading…' : 'Load more documents'}
            </Chip>
          )}
        </div>
      </ChipModalField>
      <ChipModalError>{mutationError?.message}</ChipModalError>
    </>
  )
}
