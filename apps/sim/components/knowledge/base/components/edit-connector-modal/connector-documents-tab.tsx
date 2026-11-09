'use client'

import { ConnectorDocumentStatusFilter } from '@/components/knowledge/base/components/connector-documents/connector-document-status-filter'
import { ConnectorDocuments } from '@/components/knowledge/base/components/connector-documents/connector-documents'
import type { ConnectorDocumentFilter } from '@/lib/api/contracts/knowledge/connectors'
import { useConnectorDocuments } from '@/hooks/queries/kb/connectors'

interface ConnectorDocumentsTabProps {
  knowledgeBaseId: string
  connectorId: string
  filter: ConnectorDocumentFilter
  onFilterChange: (filter: ConnectorDocumentFilter) => void
}

export function ConnectorDocumentsTab({
  knowledgeBaseId,
  connectorId,
  filter,
  onFilterChange,
}: ConnectorDocumentsTabProps) {
  return (
    <div className='px-2'>
      <ConnectorDocuments
        knowledgeBaseId={knowledgeBaseId}
        connectorId={connectorId}
        filter={filter}
        onFilterChange={onFilterChange}
        showToolbar={false}
      />
    </div>
  )
}

export function ConnectorDocumentsTabFilter({
  knowledgeBaseId,
  connectorId,
  filter,
  onFilterChange,
}: ConnectorDocumentsTabProps) {
  const query = useConnectorDocuments(knowledgeBaseId, connectorId, { filter })
  return (
    <ConnectorDocumentStatusFilter
      filter={filter}
      onFilterChange={onFilterChange}
      counts={query.data?.pages[0]?.counts}
      isLoading={query.isLoading || query.isPlaceholderData}
    />
  )
}
