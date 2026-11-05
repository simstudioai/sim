'use client'

import {
  getCredentialGroupProviderService,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { useSearchIntegrationConnection } from '@/hooks/use-search-integration-connection'
import { Button, FailureNotice } from '@/platform/design-system/components'
import { ConnectionPrompt } from '@/platform/design-system/components/connection-prompt/connection-prompt'

interface SearchConnectionRequestProps {
  organizationId: string
  userId: string
  target: SearchConnectionTarget
}

/** A connection a chat or link asked for, offered ahead of the inventory. */
export function SearchConnectionRequest({
  organizationId,
  userId,
  target,
}: SearchConnectionRequestProps) {
  const connector = SEARCH_CONNECTORS.find((entry) => entry.type === target.connectorType)
  const connection = useSearchIntegrationConnection({
    organizationId,
    userId,
    target,
    controlId: 'integrations-link',
  })
  const service = isCredentialGroupProvider(target.provider)
    ? getCredentialGroupProviderService(target.provider)
    : undefined
  const name = connector?.meta.name ?? service?.name ?? target.provider
  const action = target.credentialId ? 'Reconnect' : 'Connect'
  const title = connection.connected
    ? `Connected ${name}`
    : connection.isLoading
      ? `Checking ${name} connections`
      : connection.pending
        ? `Waiting for ${name} connection`
        : !connection.available
          ? `${name} connection is no longer available`
          : `${action} ${name}`
  const canConnect =
    !connection.isLoading &&
    !connection.isStarting &&
    !connection.connected &&
    (connection.available || connection.pending)
  return (
    <>
      <ConnectionPrompt
        title={title}
        options={
          connection.connected
            ? []
            : [
                {
                  label: action,
                  icon: { providerId: target.connectorType },
                  onConnect: canConnect ? () => void connection.connect() : undefined,
                },
              ]
        }
      />
      {connection.pending && (
        <div>
          <Button variant='quiet' onClick={connection.cancel}>
            Cancel
          </Button>
        </div>
      )}
      {connection.error && (
        <FailureNotice
          message={connection.error}
          onRetry={
            connection.inventoryError
              ? () => void connection.retry()
              : () => void connection.connect()
          }
        />
      )}
    </>
  )
}
