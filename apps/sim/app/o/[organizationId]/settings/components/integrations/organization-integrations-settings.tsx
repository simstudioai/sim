'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalError, ChipSwitch, toast } from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { getOrganizationAccountUpdateOptions } from '@/lib/credential-groups/organization-account-options'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { OrganizationIntegrationsSetup } from '@/app/o/[organizationId]/settings/components/integrations/organization-integrations-setup'
import { organizationIntegrationsTabParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { OrganizationAccountPeople } from '@/ee/credential-groups/components/organization-account-people'
import {
  useOrganizationAccounts,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'

export function OrganizationIntegrationsSettings() {
  const { organization, viewer } = useOrganizationContext()
  const [tab, setTab] = useQueryState(
    organizationIntegrationsTabParam.key,
    organizationIntegrationsTabParam.parser
  )
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
          toast.success('Connection settings refreshed')
        },
      }
    )
  }
  if (!viewer.isAdmin) return null

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex items-center justify-between gap-4'>
        <ChipSwitch
          aria-label='Source settings'
          value={tab}
          onChange={(value) => void setTab(value)}
          options={[
            { value: 'providers', label: 'Sources' },
            { value: 'people', label: 'People' },
          ]}
        />
        {tab === 'providers' && !accounts.error && group && group.options.length > 0 && (
          <RowActionsMenu
            label='More source actions'
            actions={[
              {
                label: 'Refresh connection settings',
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
      <ChipConfirmModal
        open={refreshOpen}
        onOpenChange={(open) => {
          if (!update.isPending) setRefreshOpen(open)
        }}
        title='Refresh connection settings?'
        text='Apply the latest sign-in settings to all integrations. Affected accounts will need to reconnect.'
        confirm={{ label: 'Refresh', pending: update.isPending, onClick: refreshConnections }}
      >
        <ChipModalError>{update.error?.message}</ChipModalError>
      </ChipConfirmModal>
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
