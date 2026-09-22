'use client'

import { Chip, ChipLink, toast } from '@sim/emcn'
import type { OrganizationAccountConnectionResponse } from '@/lib/api/contracts/organization-accounts'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { DisconnectAccountMenu } from '@/app/o/[organizationId]/integrations/disconnect-account-menu'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  useConnectOrganizationAccount,
  useOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'

const SOURCES: Record<string, string> = {
  'google-drive': 'google_drive',
  gmail: 'gmail',
  'google-email': 'gmail',
  'google-calendar': 'google_calendar',
  'google-docs': 'google_drive',
  'google-sheets': 'google_drive',
  'google-slides': 'google_drive',
  'github-repositories': 'github',
  slack: 'slack',
  jira: 'jira',
  confluence: 'confluence',
}

/** Uses the member OAuth enrollment flow directly, without creating or configuring an index. */
export function LiveMemberIntegrations({
  organizationId,
  search,
}: {
  organizationId: string
  search: string
}) {
  const inventory = useOrganizationAccounts(organizationId)
  const connect = useConnectOrganizationAccount()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const navigate = (result: OrganizationAccountConnectionResponse) =>
    window.location.assign(result.authorizationUrl ?? result.invitationLink)
  const onError = (error: Error) => toast.error(error.message)
  if (inventory.isError)
    return (
      <div className='p-4'>
        <p>Could not load connected accounts.</p>
        <Chip onClick={() => void inventory.refetch()}>Retry</Chip>
      </div>
    )
  if (!inventory.data) return <p className='p-4'>Loading connected accounts…</p>
  const data = inventory.data
  const options =
    data.credentialGroup?.status === 'active'
      ? data.credentialGroup.options.filter(
          (option) => option.status === 'active' && SOURCES[option.provider]
        )
      : []
  const visible = options.filter((option) =>
    `${option.label} ${option.provider}`.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div className='flex flex-col gap-3'>
      <p className='px-4 py-2 text-[var(--text-muted)] text-small'>
        Search runs directly through your accounts. Connect or reconnect here to grant permission;
        no indexing setup is needed.
      </p>
      {visible.map((option) => {
        const accounts = (data.viewerAccounts ?? []).filter(
          (account) => account.optionId === option.id
        )
        const name = connectorDisplayName(SOURCES[option.provider])
        return (
          <SettingsResourceRow
            key={option.id}
            title={option.label || name}
            description={
              accounts.length
                ? accounts
                    .map(
                      (account) =>
                        `${account.displayName}${account.status === 'needs_reauth' ? ' (reconnect needed)' : ''}`
                    )
                    .join(', ')
                : `Connect your ${name} account to search as you.`
            }
            trailing={
              <div className='flex items-center gap-2'>
                <DisconnectAccountMenu
                  organizationId={organizationId}
                  integrationName={name}
                  accounts={accounts}
                />
                {accounts.map((account) => (
                  <Chip
                    key={account.credentialId}
                    disabled={reconnect.isPending}
                    onClick={() =>
                      reconnect.mutate(account.credentialId, { onSuccess: navigate, onError })
                    }
                  >
                    Reconnect {accounts.length > 1 ? account.displayName : ''}
                  </Chip>
                ))}
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
                  {accounts.length ? 'Add account' : 'Connect'}
                </Chip>
              </div>
            }
          />
        )
      })}
      {options.length === 0 && (
        <p className='px-4 text-small'>
          An organization admin needs to enable account providers in Credential Groups.
        </p>
      )}
      {data.canManage && (
        <div className='px-4'>
          <ChipLink href={`/o/${organizationId}/settings/connected-accounts`}>
            Configure account providers
          </ChipLink>
        </div>
      )}
    </div>
  )
}
