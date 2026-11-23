'use client'

import type { SaveSearchPersonalCredentialBody } from '@/lib/api/contracts/search-personal-credentials'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { ConnectServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { useSavePersonalSearchCredential } from '@/hooks/queries/personal-search-integrations'

interface SavedSearchCredentialModalProps {
  organizationId: string
  connection: {
    providerId: SaveSearchPersonalCredentialBody['providerId']
    credentialId?: string
    displayName?: string
  }
  onClose: () => void
  onCreated?: (credentialId: string) => void
}

/** Search uses the same credential fields as workflows, with a member-owned save operation. */
export function SavedSearchCredentialModal({
  organizationId,
  connection,
  onClose,
  onCreated,
}: SavedSearchCredentialModalProps) {
  const save = useSavePersonalSearchCredential()
  const service = getServiceConfigByProviderId(connection.providerId)
  if (!service) return null
  return (
    <ConnectServiceAccountModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      organizationId={organizationId}
      serviceAccountProviderId={connection.providerId}
      serviceName={service.name}
      serviceIcon={service.icon}
      credentialId={connection.credentialId}
      credentialDisplayName={connection.displayName}
      submitPending={save.isPending}
      onCreated={onCreated}
      onSubmitCredentials={async (fields) =>
        (
          await save.mutateAsync({
            ...fields,
            organizationId,
            providerId: connection.providerId,
            credentialId: connection.credentialId,
          })
        ).credentialId
      }
    />
  )
}
