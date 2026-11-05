import { getErrorMessage } from '@sim/utils/errors'
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
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { usePlatformNotices } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import {
  toGenericSecrets,
  toOrganizationIntegrations,
  toToolPermissions,
} from '@/platform/lib/data/integrations-model'
import type {
  OrganizationIntegration,
  ToolPermissionChange,
} from '@/platform/lib/integrations/model'

const ACTION_NOTICE_ID = 'integrations-action'

function useActionFailureNotice() {
  const notices = usePlatformNotices()
  return (error: unknown) =>
    notices.notify({
      id: ACTION_NOTICE_ID,
      title: getErrorMessage(error, 'That did not work. Try again.'),
      icon: 'I070',
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
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const disconnect = useDisconnectPersonalOrganizationAccount()
  const onError = useActionFailureNotice()
  return {
    pending: connect.isPending || reconnect.isPending || disconnect.isPending,
    connect: (target: NonNullable<OrganizationIntegration['connectionTarget']>) =>
      connect.mutate({ organizationId, ...target }, { onError }),
    reconnect: (credentialId: string) => reconnect.mutate(credentialId, { onError }),
    disconnect: (credentialId: string) => disconnect.mutateAsync({ credentialId, organizationId }),
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
