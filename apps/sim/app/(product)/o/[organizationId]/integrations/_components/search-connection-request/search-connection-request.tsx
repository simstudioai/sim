'use client'

import { Button } from '@sim/emcn/button'
import { FailureNotice } from '@sim/emcn/status'
import { ConnectionPrompt } from '@sim/emcn-platform/connection-prompt'
import { SavedAccountModal } from '@/app/(product)/_components/service-account-modal/saved-account-modal'
import type { SearchConnectionTarget } from '@/platform/lib/data/chat-types'
import { useSearchConnectionRequest } from '@/platform/lib/data/integration-handoff'

interface SearchConnectionRequestProps {
  organizationId: string
  userId: string
  target: SearchConnectionTarget
}

/**
 * A connection a chat or link asked for, offered ahead of the inventory. A saved-account target
 * connects through the member's own key or app credentials instead of a provider sign-in.
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
      {connection.savedConnection && (
        <SavedAccountModal
          organizationId={organizationId}
          connection={connection.savedConnection}
          onClose={connection.closeSavedConnection}
          onCreated={connection.completeSavedConnection}
        />
      )}
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
