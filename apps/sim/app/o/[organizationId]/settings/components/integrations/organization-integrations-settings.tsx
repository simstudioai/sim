'use client'

import { Chip, ChipSwitch } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { OrganizationIntegrationsSetup } from '@/app/o/[organizationId]/settings/components/integrations/organization-integrations-setup'
import { organizationIntegrationsTabParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { OrganizationAccountPeople } from '@/ee/credential-groups/components/organization-account-people'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'

export function OrganizationIntegrationsSettings() {
  const { organization, viewer } = useOrganizationContext()
  const [tab, setTab] = useQueryState(
    organizationIntegrationsTabParam.key,
    organizationIntegrationsTabParam.parser
  )
  const accounts = useOrganizationAccounts(
    viewer.isAdmin && tab === 'people' ? organization.id : undefined
  )
  if (!viewer.isAdmin) return null

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <ChipSwitch
          aria-label='Source settings'
          value={tab}
          onChange={(value) => void setTab(value)}
          options={[
            { value: 'providers', label: 'Sources' },
            { value: 'people', label: 'People' },
          ]}
        />
      </div>
      {tab === 'providers' && <OrganizationIntegrationsSetup />}
      {tab === 'people' && (
        <OrganizationAccountPeople
          key={organization.id}
          organizationId={organization.id}
          enabled={!accounts.error && (!accounts.data || Boolean(accounts.data.credentialGroup))}
          setupFallback={
            accounts.error ? (
              <SettingsQueryErrorState
                error={accounts.error}
                fallback='Could not load connected accounts'
                isRetrying={accounts.isFetching}
                onRetry={() => void accounts.refetch()}
                variant='inline'
              />
            ) : !accounts.data ? (
              <SettingsEmptyState variant='inline'>Loading connected accounts…</SettingsEmptyState>
            ) : !accounts.data.credentialGroup ? (
              <div className='flex flex-col items-start gap-4'>
                <SettingsEmptyState variant='inline'>
                  Add a source that uses member accounts before requesting connections.
                </SettingsEmptyState>
                <Chip onClick={() => void setTab('providers')}>View sources</Chip>
              </div>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
