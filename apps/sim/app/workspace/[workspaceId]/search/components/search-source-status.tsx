'use client'

import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { useRouter } from 'next/navigation'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import { ConnectorsSection } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorData } from '@/hooks/queries/kb/connectors'

interface SearchSourceStatusProps {
  scope: ResourceScope
  knowledgeBaseId: string
  connectorType: string
  connectors: ConnectorData[]
  isLoading: boolean
  onClose: () => void
}

/** Search reuses the connector's sync status, history, and recovery controls. */
export function SearchSourceStatus({
  scope,
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
        <ChipModalField type='custom' title='Sync status'>
          <ConnectorsSection
            scope={scope}
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
          onClick: () =>
            router.push(
              scope.kind === 'organization'
                ? organizationRoutes(scope.organizationId).search
                : `/workspace/${scope.workspaceId}/home?mode=search`
            ),
        }}
      />
    </ChipModal>
  )
}
