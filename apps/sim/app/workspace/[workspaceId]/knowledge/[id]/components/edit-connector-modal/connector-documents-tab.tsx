'use client'

import { useState } from 'react'
import { ChipModalField } from '@sim/emcn'
import type { ConnectorDocumentFilter } from '@/lib/api/contracts/knowledge/connectors'
import { ConnectorDocuments } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-documents/connector-documents'

interface ConnectorDocumentsTabProps {
  knowledgeBaseId: string
  connectorId: string
}

export function ConnectorDocumentsTab({
  knowledgeBaseId,
  connectorId,
}: ConnectorDocumentsTabProps) {
  const [filter, setFilter] = useState<ConnectorDocumentFilter>('active')
  return (
    <ChipModalField type='custom' title='Documents'>
      <ConnectorDocuments
        knowledgeBaseId={knowledgeBaseId}
        connectorId={connectorId}
        filter={filter}
        onFilterChange={setFilter}
      />
    </ChipModalField>
  )
}
