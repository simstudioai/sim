'use client'

import { Button } from '@sim/emcn/button'
import { FailureNotice } from '@sim/emcn/status'
import { ConnectionPrompt } from '@sim/emcn-platform/connection-prompt'
import type { SearchConnectionTarget } from '@/platform/lib/data/chat-types'
import { useSearchConnectionRequest } from '@/platform/lib/data/integration-handoff'

interface SearchConnectionRequestProps {
  organizationId: string
  userId: string
  target: SearchConnectionTarget
}

/**
 * A connection a chat or link asked for, offered ahead of the inventory. A saved-account target has
 * no connect action here: its credential form is not on the Platform yet.
 */
export function SearchConnectionRequest({
  organizationId,
  userId,
  target,
}: SearchConnectionRequestProps) {
  const connection = useSearchConnectionRequest(organizationId, userId, target)
  const { action, label, disabled } = connection
  return (
    <>
      <ConnectionPrompt
        title={label}
        options={
          connection.connected || target.savedProviderId
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
