import { useCallback, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { SaveSearchPersonalCredentialBody } from '@/lib/api/contracts/search-personal-credentials'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import {
  useAssistantToolPermissions,
  useUpdateAssistantToolPermissions,
} from '@/hooks/queries/assistant-actions'
import {
  useConnectOrganizationAccount,
  useDisconnectPersonalOrganizationAccount,
  useOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'
import { useOrganizationSecretSource } from '@/hooks/queries/organization-secrets'
import { useRemovePersonalSearchCredential } from '@/hooks/queries/personal-search-integrations'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import {
  toGenericSecrets,
  toOrganizationIntegrations,
  toToolPermissions,
} from '@/platform/embedded/lib/data/integrations-model'
import { usePlatformNotices } from '@/platform/embedded/lib/notices'
import type { OrganizationIntegration, ToolPermissionChange } from '@/platform/shared/integrations'

const ACTION_NOTICE_ID = 'integrations-action'

function useActionFailureNotice() {
  const notices = usePlatformNotices()
  return (error: unknown) =>
    notices.notify({
      id: ACTION_NOTICE_ID,
      title: getErrorMessage(error, 'That did not work. Try again.'),
      variant: 'error',
    })
}

/** The member inventory and its reads, each failing and retrying on its own. */
export function useMemberIntegrations(organizationId: string) {
  const inventory = useOrganizationAccounts(organizationId)
  const policies = useSearchIntegrations(organizationId)
  const secrets = useOrganizationSecretSource(organizationId)
  return {
    integrations: inventory.data
      ? toOrganizationIntegrations(inventory.data, policies.isSuccess ? policies.data : undefined)
      : [],
    genericSecrets: toGenericSecrets(secrets.data?.source),
    inventory,
    policies,
    secrets,
  }
}

export function useIntegrationActions(organizationId: string) {
  const [savedConnection, setSavedConnection] = useState<{
    providerId: SaveSearchPersonalCredentialBody['providerId']
    credentialId?: string
    displayName?: string
  } | null>(null)
  const inventory = useOrganizationAccounts(organizationId)
  const savedAccounts = inventory.data?.viewerSavedAccounts ?? []
  const removeSaved = useRemovePersonalSearchCredential()
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const disconnect = useDisconnectPersonalOrganizationAccount()
  const onError = useActionFailureNotice()
  const connecting = connect.isPending || reconnect.isPending
  const closeSavedConnection = useCallback(() => setSavedConnection(null), [])
  return {
    connecting,
    pending: connecting || disconnect.isPending || removeSaved.isPending,
    savedConnection,
    closeSavedConnection,
    connect: (
      target: NonNullable<OrganizationIntegration['connectionTarget']>,
      onConnected?: () => void
    ) => {
      if ('savedProviderId' in target) setSavedConnection({ providerId: target.savedProviderId })
      else
        connect.mutate(
          { organizationId, ...target },
          { onError, onSuccess: (connected) => connected && onConnected?.() }
        )
    },
    reconnect: (credentialId: string, onConnected?: () => void) => {
      const saved = savedAccounts.find((account) => account.credentialId === credentialId)
      if (saved)
        setSavedConnection({
          providerId: saved.providerId,
          credentialId,
          displayName: saved.displayName,
        })
      else
        reconnect.mutate(credentialId, {
          onError,
          onSuccess: (connected) => connected && onConnected?.(),
        })
    },
    disconnect: async (credentialId: string) => {
      if (savedAccounts.some((account) => account.credentialId === credentialId))
        await removeSaved.mutateAsync({ organizationId, credentialId })
      else await disconnect.mutateAsync({ credentialId, organizationId })
    },
  }
}

export function useToolPermissions(organizationId: string, credentialId: string) {
  const query = useAssistantToolPermissions(organizationId, credentialId)
  const update = useUpdateAssistantToolPermissions(organizationId, credentialId)
  const onError = useActionFailureNotice()
  const data = query.data
  const display = data && resolveCredentialDisplay({ ...data.account, type: 'managed_oauth' })
  return {
    query,
    pending: update.isPending,
    view: data &&
      display && {
        permissions: toToolPermissions(data),
        heading: {
          name: display.detailTitle || data.account.providerId,
          account: data.account.displayName,
          icon: display.icon ?? undefined,
        },
      },
    save(change: ToolPermissionChange) {
      if (!data || update.isPending) return
      update.mutate({ revision: data.revision, change }, { onError })
    },
  }
}
