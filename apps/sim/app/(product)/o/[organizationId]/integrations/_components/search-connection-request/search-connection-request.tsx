'use client'

import { Button } from '@sim/emcn/button'
import { FailureNotice } from '@sim/emcn/status'
import { ConnectionPrompt } from '@sim/emcn-platform/connection-prompt'
import { ServiceAccountModal } from '@/app/(product)/_components/service-account-modal/service-account-modal'
import type { SearchConnectionTarget } from '@/platform/lib/data/chat-types'
import {
  useSavedSearchCredential,
  useSearchConnectionRequest,
} from '@/platform/lib/data/integration-handoff'

interface SearchConnectionRequestProps {
  organizationId: string
  userId: string
  target: SearchConnectionTarget
}

interface SavedAccountDialogProps {
  organizationId: string
  connection: Parameters<typeof useSavedSearchCredential>[1]
  onClose: () => void
  onCreated: (credentialId: string) => void
}

/** The member's own key or app credentials for a saved-account link, saved to their account. */
function SavedAccountDialog({
  organizationId,
  connection,
  onClose,
  onCreated,
}: SavedAccountDialogProps) {
  const saved = useSavedSearchCredential(organizationId, connection)
  if (!saved) return null
  return (
    <ServiceAccountModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      scope={{ kind: 'organization', organizationId }}
      serviceAccountProviderId={connection.providerId}
      serviceName={saved.serviceName}
      onCreated={onCreated}
      submitCredentials={saved.submit}
      submitPending={saved.pending}
    />
  )
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
        <SavedAccountDialog
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
