'use client'

import { Chip, ChipSwitch } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { OrganizationAccountApiKeys } from '@/ee/credential-groups/components/organization-account-api-keys'
import { OrganizationAccountPeople } from '@/ee/credential-groups/components/organization-account-people'
import { OrganizationAccountProviders } from '@/ee/credential-groups/components/organization-account-providers'
import { OrganizationAccountWorkspaceAccess } from '@/ee/credential-groups/components/organization-account-workspace-access'
import { credentialGroupsParsers } from '@/ee/credential-groups/search-params'
import {
  useEnsureOrganizationAccounts,
  useOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'

interface OrganizationConnectedAccountsProps {
  organizationId: string
}

export function OrganizationConnectedAccounts({
  organizationId,
}: OrganizationConnectedAccountsProps) {
  const accounts = useOrganizationAccounts(organizationId)
  const ensure = useEnsureOrganizationAccounts()
  const [{ tab }, setView] = useQueryStates(credentialGroupsParsers)
  const error = accounts.error ?? ensure.error
  if (error)
    return (
      <SettingsQueryErrorState
        error={error}
        fallback='Could not load Credential Groups'
        isRetrying={accounts.isFetching || ensure.isPending}
        onRetry={() => {
          ensure.reset()
          void accounts.refetch()
        }}
      />
    )
  if (!accounts.data)
    return <SettingsEmptyState variant='inline'>Loading Credential Groups…</SettingsEmptyState>
  if (!accounts.data.canManage)
    return <SettingsEmptyState>An organization admin manages Credential Groups.</SettingsEmptyState>
  const group = accounts.data.credentialGroup
  if (!group)
    return (
      <div className='flex flex-col gap-4'>
        <p className='text-[var(--text-muted)] text-small'>
          Set up one shared account pool for your organization. Workspaces have no access until you
          allow them.
        </p>
        <div>
          <Chip
            variant='primary'
            disabled={ensure.isPending}
            onClick={() => ensure.mutate({ organizationId })}
          >
            Set up Credential Groups
          </Chip>
        </div>
      </div>
    )
  return (
    <div className='flex flex-col gap-7'>
      <div>
        <ChipSwitch
          aria-label='Credential Groups views'
          value={tab}
          onChange={(value) => void setView({ tab: value })}
          options={[
            { value: 'providers', label: 'Integrations' },
            { value: 'people', label: 'People' },
            { value: 'workspace-access', label: 'Access' },
          ]}
        />
      </div>
      {tab === 'providers' && (
        <>
          <OrganizationAccountProviders
            organizationId={organizationId}
            group={group}
            availableProviders={accounts.data.availableProviders}
          />
          <OrganizationAccountApiKeys organizationId={organizationId} group={group} />
        </>
      )}
      {tab === 'people' && <OrganizationAccountPeople organizationId={organizationId} />}
      {tab === 'workspace-access' && (
        <OrganizationAccountWorkspaceAccess organizationId={organizationId} />
      )}
    </div>
  )
}
