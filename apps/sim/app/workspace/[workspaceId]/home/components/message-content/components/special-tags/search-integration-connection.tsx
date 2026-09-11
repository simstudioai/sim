'use client'

import { useState } from 'react'
import { Chip } from '@sim/emcn'
import { Check } from '@sim/emcn/icons'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import {
  InteractionCard,
  InteractionCardActionRow,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import { BrandIcon } from '@/blocks/brand-icon'
import { useSearchIntegrationConnection } from '@/hooks/use-search-integration-connection'

export interface SearchIntegrationConnectionProps {
  organizationId: string
  userId: string
  target: SearchConnectionTarget
  controlId: string
  embedded?: boolean
  divided?: boolean
  onConnected?: () => void
}

/** The ordinary credential card, with personal Search enrollment instead of workspace credentials. */
export function SearchIntegrationConnection(props: SearchIntegrationConnectionProps) {
  return (
    <SearchIntegrationConnectionControl
      key={JSON.stringify([props.organizationId, props.userId, props.controlId, props.target])}
      {...props}
    />
  )
}

function SearchIntegrationConnectionControl({
  organizationId,
  userId,
  target,
  controlId,
  embedded,
  divided,
  onConnected,
}: SearchIntegrationConnectionProps) {
  const [setupOpen, setSetupOpen] = useState(false)
  const connector = SEARCH_CONNECTORS.find((entry) => entry.type === target.connectorType)
  const connection = useSearchIntegrationConnection({
    organizationId,
    userId,
    target,
    controlId,
    onConnected,
  })
  const name = connector?.meta.name ?? target.provider
  const action = target.credentialId ? 'Reconnect' : 'Connect'
  const connected = connection.connected
  const label = connected
    ? `Connected ${name}`
    : connection.isLoading
      ? `Checking ${name} connections…`
      : connection.pending
        ? `Waiting for ${name} connection…`
        : !connection.available
          ? `${name} connection is no longer available`
          : `${action} ${name}`
  const handleConnect = () => {
    if (connector && !connection.connectorId && connector.setupFields.length && !connection.pending)
      setSetupOpen(true)
    else void connection.connect()
  }
  const content = (
    <>
      <InteractionCardActionRow
        label={label}
        divided={Boolean(divided)}
        disabled={
          !connector ||
          connection.isLoading ||
          connection.isStarting ||
          connected ||
          (!connection.available && !connection.pending)
        }
        onClick={handleConnect}
        leading={
          connector && <BrandIcon icon={connector.serviceIcon} className='size-[16px] shrink-0' />
        }
        trailing={connected ? <Check className='size-[16px] text-[var(--text-icon)]' /> : undefined}
      />
      {connection.pending && <Chip onClick={connection.cancel}>Cancel</Chip>}
      {connection.error && (
        <div role='alert' className='px-2 py-2 text-[var(--text-error)] text-caption'>
          {connection.error}{' '}
          <Chip onClick={connection.inventoryError ? () => void connection.retry() : handleConnect}>
            Retry
          </Chip>
        </div>
      )}
      {setupOpen && connector && (
        <SourceSetupModal
          organizationId={organizationId}
          onConnected={connection.completeSetup}
          connector={connector}
          onClose={() => setSetupOpen(false)}
          isPending={connection.isStarting}
          error={connection.error}
          onConnect={(config) => {
            void connection.connect(config).then((started) => {
              if (started) setSetupOpen(false)
            })
          }}
        />
      )}
    </>
  )
  return embedded ? content : <InteractionCard>{content}</InteractionCard>
}
