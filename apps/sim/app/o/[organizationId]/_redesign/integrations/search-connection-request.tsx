'use client'

import { Button } from '@sim/emcn/button'
import { FailureNotice } from '@sim/emcn/status'
import { ConnectionPrompt } from '@sim/emcn-platform/connection-prompt'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { useSearchIntegrationConnection } from '@/hooks/use-search-integration-connection'

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
  const connection = useSearchIntegrationConnection({
    organizationId,
    userId,
    target,
    controlId: 'integrations-link',
  })
  const { action, label, disabled } = connection
  return (
    <>
      <ConnectionPrompt
        title={label}
        options={
          connection.connected
            ? []
            : [
                {
                  label: action,
                  icon: { providerId: target.connectorType },
                  onConnect: disabled ? undefined : () => void connection.connect(),
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
