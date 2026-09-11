'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalError, ChipSwitch, toast } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { getOrganizationAccountUpdateOptions } from '@/lib/credential-groups/organization-account-options'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { OrganizationIntegrationsSetup } from '@/app/o/[organizationId]/settings/components/integrations/organization-integrations-setup'
import { OrganizationSourcePeople } from '@/app/o/[organizationId]/settings/components/integrations/organization-source-people'
import { OrganizationSourceStats } from '@/app/o/[organizationId]/settings/components/integrations/organization-source-stats'
import {
  organizationIntegrationsTabParam,
  organizationPeopleIntegrationParam,
} from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  useOrganizationAccounts,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'

export function OrganizationIntegrationsSettings() {
  const { organization, viewer } = useOrganizationContext()
  const [{ tab }, setNavigation] = useQueryStates({
    [organizationIntegrationsTabParam.key]: organizationIntegrationsTabParam.parser,
    [organizationPeopleIntegrationParam.key]: organizationPeopleIntegrationParam.parser,
  })
  const accounts = useOrganizationAccounts(viewer.isAdmin ? organization.id : undefined)
  const update = useUpdateOrganizationAccounts()
  const [refreshOpen, setRefreshOpen] = useState(false)
  const group = accounts.data?.credentialGroup
  const refreshConnections = () => {
    if (!group || update.isPending) return
    update.mutate(
      {
        organizationId: organization.id,
        groupId: group.id,
        update: { options: getOrganizationAccountUpdateOptions(group) },
      },
      {
        onSuccess: () => {
          setRefreshOpen(false)
          toast.success('Sign-in settings updated')
        },
      }
    )
  }
  if (!viewer.isAdmin) return null

  const tabs = (
    <ChipSwitch
      aria-label='Source settings'
      value={tab}
      onChange={(value) => void setNavigation({ tab: value, integration: null })}
      options={[
        { value: 'providers', label: 'Sources' },
        { value: 'people', label: 'People' },
        { value: 'stats', label: 'Stats' },
      ]}
    />
  )

  return (
    <div className='flex flex-col gap-6'>
      {tab === 'providers' && (
        <div className='flex items-center justify-between gap-4'>
          {tabs}
          {tab === 'providers' && !accounts.error && group && group.options.length > 0 && (
            <RowActionsMenu
              label='More source actions'
              actions={[
                {
                  label: 'Update sign-in settings',
                  disabled: update.isPending,
                  onSelect: () => {
                    update.reset()
                    setRefreshOpen(true)
                  },
                },
              ]}
            />
          )}
        </div>
      )}
      <ChipConfirmModal
        open={refreshOpen}
        onOpenChange={(open) => {
          if (!update.isPending) setRefreshOpen(open)
        }}
        title='Update sign-in settings?'
        text='Apply Sim’s current OAuth app and permission settings to member connections. People whose settings changed must reconnect. This does not sync content.'
        confirm={{ label: 'Update', pending: update.isPending, onClick: refreshConnections }}
      >
        <ChipModalError>{update.error?.message}</ChipModalError>
      </ChipConfirmModal>
      {tab === 'providers' && <OrganizationIntegrationsSetup />}
      {tab === 'stats' && <OrganizationSourceStats organizationId={organization.id} tabs={tabs} />}
      {tab === 'people' && (
        <OrganizationSourcePeople
          key={organization.id}
          organizationId={organization.id}
          options={group?.options ?? []}
          tabs={tabs}
          enabled={Boolean(accounts.isSuccess && group)}
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
                <Chip onClick={() => void setNavigation({ tab: 'providers', integration: null })}>
                  View sources
                </Chip>
              </div>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
