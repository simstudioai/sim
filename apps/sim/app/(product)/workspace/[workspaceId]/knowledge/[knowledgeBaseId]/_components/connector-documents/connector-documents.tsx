'use client'

import { Button, IconButton } from '@sim/emcn/button'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import { FailureNotice } from '@sim/emcn/status'
import Link from 'next/link'
import styles from '@/app/(product)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/connector-documents/connector-documents.module.css'
import { getDocumentIndexingStatus, useUpdateDocument } from '@/platform/lib/data/knowledge'
import {
  type ConnectorDocumentFilter,
  useConnectorDocuments,
  useExcludeConnectorDocument,
  useRestoreConnectorDocument,
} from '@/platform/lib/data/knowledge/connectors'

const FILTERS: readonly ConnectorDocumentFilter[] = ['active', 'excluded', 'failed', 'skipped']
const FILTER_LABELS: Record<ConnectorDocumentFilter, string> = {
  active: 'Included',
  excluded: 'Excluded',
  failed: 'Failed',
  skipped: 'Skipped',
}
const EMPTY: Record<ConnectorDocumentFilter, string> = {
  active: 'No documents yet.',
  excluded: 'No excluded documents.',
  failed: 'No failed documents.',
  skipped: 'No skipped documents.',
}

interface DocumentFilterProps {
  knowledgeBaseId: string
  connectorId: string
  filter: ConnectorDocumentFilter
  onFilterChange: (filter: ConnectorDocumentFilter) => void
}

/** Which of a connector's documents to list, each choice counting its documents. */
export function ConnectorDocumentFilterMenu({
  knowledgeBaseId,
  connectorId,
  filter,
  onFilterChange,
}: DocumentFilterProps) {
  const query = useConnectorDocuments(knowledgeBaseId, connectorId, { filter })
  const counts = query.data?.pages[0]?.counts
  const loading = query.isLoading || query.isPlaceholderData
  return (
    <ChoiceMenu
      label='Document status'
      value={filter}
      onValueChange={(value) => {
        const next = FILTERS.find((item) => item === value)
        if (next) onFilterChange(next)
      }}
      options={FILTERS.map((value) => ({
        value,
        label:
          loading || !counts ? FILTER_LABELS[value] : `${FILTER_LABELS[value]} (${counts[value]})`,
      }))}
    />
  )
}

interface ConnectorDocumentsProps {
  knowledgeBaseId: string
  connectorId: string
  filter: ConnectorDocumentFilter
}

/**
 * The documents a connector synced, by status: each opens its source, a failed one can be indexed
 * again, and any can be excluded from future syncs or restored. The list pages as it is asked to.
 */
export function ConnectorDocuments({
  knowledgeBaseId,
  connectorId,
  filter,
}: ConnectorDocumentsProps) {
  const query = useConnectorDocuments(knowledgeBaseId, connectorId, { filter })
  const exclude = useExcludeConnectorDocument()
  const restore = useRestoreConnectorDocument()
  const retry = useUpdateDocument()
  const failure = exclude.error ?? restore.error ?? retry.error
  const busy = exclude.isPending || restore.isPending || retry.isPending
  const loading = query.isLoading || query.isPlaceholderData
  const documents = (query.data?.pages.flatMap((page) => page.documents) ?? []).filter(
    (document) =>
      filter === 'excluded'
        ? document.userExcluded
        : !document.userExcluded &&
          (filter === 'active' || getDocumentIndexingStatus(document) === filter)
  )
  const total = query.data?.pages[0]?.counts[filter] ?? 0
  const more = Boolean(query.hasNextPage && documents.length < total)

  function resetErrors() {
    exclude.reset()
    restore.reset()
    retry.reset()
  }

  if (query.isError && !query.isFetchNextPageError)
    return (
      <FailureNotice
        message='Could not load documents.'
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )
  if (loading) return null

  return (
    <div className={styles.documents}>
      {total === 0 ? (
        <p className={styles.empty} data-type='T060'>
          {EMPTY[filter]}
        </p>
      ) : (
        <ul className={styles.list} aria-label={`${FILTER_LABELS[filter]} documents`}>
          {documents.map((document) => {
            const status = getDocumentIndexingStatus(document)
            const detail =
              status === 'failed'
                ? 'Indexing failed'
                : status === 'skipped'
                  ? document.processingError
                    ? `Skipped · ${document.processingError}`
                    : 'Skipped'
                  : document.processingStatus === 'pending'
                    ? 'Waiting to index'
                    : document.processingStatus === 'processing'
                      ? 'Indexing'
                      : undefined
            return (
              <li key={document.id} className={styles.row}>
                <span className={styles.copy}>
                  <span className={styles.name} data-type='T060'>
                    <OverflowText text={document.filename}>{document.filename}</OverflowText>
                  </span>
                  {detail && (
                    <span className={styles.detail} data-type='T052'>
                      {detail}
                    </span>
                  )}
                </span>
                <span className={styles.actions}>
                  {document.sourceUrl && (
                    <IconButton
                      label={`Open ${document.filename}`}
                      icon='I037'
                      tooltip
                      render={
                        <Link href={document.sourceUrl} target='_blank' rel='noopener noreferrer' />
                      }
                    />
                  )}
                  {status === 'failed' && !document.userExcluded && (
                    <Button
                      variant='quiet'
                      size='compact'
                      disabled={busy}
                      onClick={() => {
                        resetErrors()
                        retry.mutate({
                          knowledgeBaseId,
                          documentId: document.id,
                          updates: { retryProcessing: true },
                        })
                      }}
                    >
                      Retry indexing
                    </Button>
                  )}
                  <Button
                    variant='quiet'
                    size='compact'
                    disabled={busy}
                    onClick={() => {
                      resetErrors()
                      const input = { knowledgeBaseId, connectorId, documentIds: [document.id] }
                      if (document.userExcluded) restore.mutate(input)
                      else exclude.mutate(input)
                    }}
                  >
                    {document.userExcluded ? 'Restore' : 'Exclude'}
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {query.isFetchNextPageError ? (
        <FailureNotice
          message='Could not load more documents.'
          retrying={query.isFetchingNextPage}
          onRetry={() => void query.fetchNextPage()}
        />
      ) : more ? (
        <span className={styles.more}>
          <Button
            variant='quiet'
            size='compact'
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more documents'}
          </Button>
        </span>
      ) : null}
      {failure && (
        <p className={styles.error} data-type='T060' role='alert'>
          {failure.message}
        </p>
      )}
    </div>
  )
}
