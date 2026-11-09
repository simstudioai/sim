'use client'

import { ServiceAccountModal } from '@/app/(product)/_components/service-account-modal/service-account-modal'
import {
  type SavedSearchConnection,
  useSavedSearchCredential,
} from '@/platform/lib/data/integration-handoff'

interface SavedAccountModalProps {
  organizationId: string
  connection: SavedSearchConnection
  onClose: () => void
  onCreated?: (credentialId: string) => void
}

/**
 * The member's own key or app credentials for a saved Search account, added or replaced in place and
 * saved to their account, from a connection link, the Integrations page or Home.
 */
export function SavedAccountModal({
  organizationId,
  connection,
  onClose,
  onCreated,
}: SavedAccountModalProps) {
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
      onCreated={(credentialId) => onCreated?.(credentialId)}
      submitCredentials={saved.submit}
      submitPending={saved.pending}
      replacedAccount={
        connection.credentialId ? { displayName: connection.displayName } : undefined
      }
    />
  )
}
