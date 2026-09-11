'use client'

import { Chip, toast } from '@sim/emcn'
import type { OrganizationAccountConnectionResponse } from '@/lib/api/contracts/organization-accounts'
import { DisconnectAccountMenu } from '@/app/o/[organizationId]/integrations/disconnect-account-menu'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  useConnectOrganizationAccount,
  type useOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'

interface GitHubMemberIntegrationProps {
  organizationId: string
  inventory: ReturnType<typeof useOrganizationAccounts>
  canConnect: boolean
}

/** A member authorizes GitHub once, independently of the repositories added by admins. */
export function GitHubMemberIntegration({
  organizationId,
  inventory,
  canConnect,
}: GitHubMemberIntegrationProps) {
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const accounts =
    inventory.data?.viewerAccounts?.filter(
      (account) => account.providerId === 'github-repositories'
    ) ?? []
  const account = accounts.find((entry) => entry.status === 'needs_reauth') ?? accounts[0]
  const option =
    inventory.data?.credentialGroup?.status === 'active'
      ? inventory.data.credentialGroup.options.find(
          (entry) => entry.provider === 'github-repositories' && entry.status === 'active'
        )
      : undefined
  const loading = inventory.isPending && !inventory.data
  const failed = inventory.isError
  const meta = CONNECTOR_META_REGISTRY.github
  const navigate = ({ authorizationUrl, invitationLink }: OrganizationAccountConnectionResponse) =>
    window.location.assign(authorizationUrl ?? invitationLink)
  const onError = (error: Error) => toast.error(error.message)
  const description = account
    ? `${accounts.map((entry) => entry.displayName).join(', ')} · ${account.status === 'needs_reauth' ? 'Reconnect required' : 'Connected'}`
    : loading
      ? 'Loading connection…'
      : failed
        ? 'Could not load connection'
        : option
          ? 'Connect once to search the repositories your admin adds'
          : 'An admin needs to reconnect GitHub'

  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={meta ? <IntegrationTile blockType='github' icon={meta.icon} /> : undefined}
      title='GitHub'
      description={description}
      trailing={
        <div className='flex items-center gap-2'>
          <DisconnectAccountMenu
            organizationId={organizationId}
            integrationName='GitHub'
            accounts={accounts}
          />
          {failed ? (
            <Chip disabled={inventory.isFetching} onClick={() => void inventory.refetch()}>
              {inventory.isFetching ? 'Retrying…' : 'Retry'}
            </Chip>
          ) : account?.status === 'needs_reauth' && option?.id === account.optionId ? (
            <Chip
              variant='primary'
              disabled={reconnect.isPending}
              onClick={() =>
                reconnect.mutate(account.credentialId, { onSuccess: navigate, onError })
              }
            >
              Reconnect
            </Chip>
          ) : !account && !loading && canConnect && option ? (
            <Chip
              variant='primary'
              disabled={connect.isPending}
              onClick={() =>
                connect.mutate(
                  { organizationId, optionId: option.id },
                  { onSuccess: navigate, onError }
                )
              }
            >
              Connect
            </Chip>
          ) : null}
        </div>
      }
    />
  )
}
