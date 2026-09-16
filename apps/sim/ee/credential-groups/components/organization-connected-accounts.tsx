'use client'

import { Chip, ChipSwitch } from '@sim/emcn'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { OrganizationAccountPeople } from '@/ee/credential-groups/components/organization-account-people'
import { OrganizationAccountProviders } from '@/ee/credential-groups/components/organization-account-providers'
import { OrganizationAccountWorkspaceAccess } from '@/ee/credential-groups/components/organization-account-workspace-access'
import {
  useEnsureOrganizationAccounts,
  useOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'

const TABS = ['providers', 'people', 'workspace-access'] as const
interface OrganizationConnectedAccountsProps {
  organizationId: string
}

export function OrganizationConnectedAccounts({
  organizationId,
}: OrganizationConnectedAccountsProps) {
  const accounts = useOrganizationAccounts(organizationId)
  const ensure = useEnsureOrganizationAccounts()
  const [tab, setTab] = useQueryState('tab', parseAsStringLiteral(TABS).withDefault('providers'))
  const error = accounts.error ?? ensure.error
  if (error)
    return (
      <SettingsQueryErrorState
        error={error}
        fallback='Could not load connected accounts'
        isRetrying={accounts.isFetching || ensure.isPending}
        onRetry={() => {
          ensure.reset()
          void accounts.refetch()
        }}
      />
    )
  if (!accounts.data)
    return <p className='text-[var(--text-muted)] text-caption'>Loading connected accounts…</p>
  if (!accounts.data.canManage)
    return <p className='text-small'>An organization admin manages connected accounts.</p>
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
            Set up connected accounts
          </Chip>
        </div>
      </div>
    )
  return (
    <div className='flex flex-col gap-6'>
      <div>
        <ChipSwitch
          value={tab}
          onChange={(value) => void setTab(value)}
          options={[
            { value: 'providers', label: 'Providers' },
            { value: 'people', label: 'People' },
            { value: 'workspace-access', label: 'Workspace access' },
          ]}
        />
      </div>
      {tab === 'providers' && (
        <OrganizationAccountProviders
          organizationId={organizationId}
          group={group}
          availableProviders={accounts.data.availableProviders}
        />
      )}
      {tab === 'people' && <OrganizationAccountPeople organizationId={organizationId} />}
      {tab === 'workspace-access' && (
        <OrganizationAccountWorkspaceAccess organizationId={organizationId} />
      )}
    </div>
  )
}
