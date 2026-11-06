'use client'

import { Chip } from '@sim/emcn'
import { Check } from '@sim/emcn/icons'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import {
  InteractionCard,
  InteractionCardActionRow,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import { SavedSearchCredentialModal } from '@/app/workspace/[workspaceId]/integrations/components/saved-search-credential-modal'
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
  const connection = useSearchIntegrationConnection({
    organizationId,
    userId,
    target,
    controlId,
    onConnected,
  })
  const { icon, label, disabled, connected } = connection
  const handleConnect = () => void connection.connect()
  const content = (
    <>
      {connection.savedConnection && (
        <SavedSearchCredentialModal
          organizationId={organizationId}
          connection={connection.savedConnection}
          onClose={connection.closeSavedConnection}
          onCreated={connection.completeSavedConnection}
        />
      )}
      <InteractionCardActionRow
        label={label}
        divided={Boolean(divided)}
        disabled={disabled}
        onClick={handleConnect}
        leading={icon && <BrandIcon icon={icon} className='size-[16px] shrink-0' />}
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
    </>
  )
  return embedded ? content : <InteractionCard>{content}</InteractionCard>
}
