'use client'

import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { ConnectorsSection } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorData } from '@/hooks/queries/kb/connectors'

interface SearchSourceStatusProps {
  workspaceId: string
  knowledgeBaseId: string
  connectorType: string
  connectors: ConnectorData[]
  isLoading: boolean
  onClose: () => void
}

/** Search reuses the connector's sync status, history, and recovery controls. */
export function SearchSourceStatus({
  workspaceId,
  knowledgeBaseId,
  connectorType,
  connectors,
  isLoading,
  onClose,
}: SearchSourceStatusProps) {
  const router = useRouter()
  const title = `${CONNECTOR_META_REGISTRY[connectorType]?.name ?? 'Source'} sources`
  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle={title}
      size='lg'
    >
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='custom'
          title='Sync status'
          hint='Documents appear in Search as they finish indexing. Open a source below for sync history and recovery actions.'
        >
          <ConnectorsSection
            workspaceId={workspaceId}
            knowledgeBaseId={knowledgeBaseId}
            isSearchIndex
            connectors={connectors}
            isLoading={isLoading}
            canEdit
          />
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter
        hideCancel
        primaryAction={{
          label: 'Start searching',
          onClick: () => router.push(`/workspace/${workspaceId}/home?mode=search`),
        }}
      />
    </ChipModal>
  )
}
