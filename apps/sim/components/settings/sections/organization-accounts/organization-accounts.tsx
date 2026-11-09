'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, toast } from '@sim/emcn-legacy'
import { ArrowLeft } from '@sim/emcn-legacy/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { RowActionsMenu } from '@/components/settings/primitives/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/components/settings/primitives/settings-empty-state'
import { SettingsPanel } from '@/components/settings/primitives/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/components/settings/primitives/settings-resource-row'
import { SettingsSection } from '@/components/settings/primitives/settings-section/settings-section'
import type { PersonalOrganizationAccount } from '@/lib/api/contracts/organization-accounts'
import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import {
  getManagedMcpConnector,
  isManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import {
  groupByOrganization,
  PERSONAL_ACCOUNT_STATUS_LABELS,
} from '@/lib/organizations/personal-accounts'
import {
  useDisconnectPersonalOrganizationAccount,
  usePersonalOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'

const LOAD_ERROR = 'Failed to load connected accounts'

interface OrganizationAccountsProps {
  onBack: () => void
}

function accountService(account: PersonalOrganizationAccount) {
  if (account.kind === 'mcp') {
    if (!isManagedMcpConnectorId(account.providerId)) return null
    return {
      name: getManagedMcpConnector(account.providerId).name,
      icon: getManagedMcpConnectorIcon(account.providerId),
    }
  }
  return getServiceConfigByProviderId(account.providerId)
}

/**
 * The accounts this person connected for an organization. Membership does not
 * gate it: someone who left an organization still disconnects their own grants
 * here, because the organization's Integrations page is closed to them.
 */
export function OrganizationAccounts({ onBack }: OrganizationAccountsProps) {
  const accounts = usePersonalOrganizationAccounts()
  const disconnect = useDisconnectPersonalOrganizationAccount()
  const [pendingDisconnectId, setPendingDisconnectId] = useState<string | null>(null)

  const list = accounts.data?.pages.flatMap((page) => page.accounts) ?? []
  const pendingDisconnect =
    list.find((account) => account.credentialId === pendingDisconnectId) ?? null

  const confirmDisconnect = () => {
    if (!pendingDisconnect) return
    disconnect.mutate(
      {
        credentialId: pendingDisconnect.credentialId,
        organizationId: pendingDisconnect.organizationId,
      },
      {
        onSuccess: () => toast.success(`Disconnected ${pendingDisconnect.displayName}`),
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to disconnect account')),
        onSettled: () => setPendingDisconnectId(null),
      }
    )
  }

  return (
    <>
      <SettingsPanel
        back={{ text: 'General', icon: ArrowLeft, onSelect: onBack }}
        title='Connected organization accounts'
        description='Disconnect accounts you connected for an organization, including ones you have left.'
      >
        {accounts.isError && accounts.data === undefined ? (
          <SettingsQueryErrorState
            error={accounts.error}
            fallback={LOAD_ERROR}
            isRetrying={accounts.isFetching}
            onRetry={() => accounts.refetch()}
          />
        ) : accounts.isPending ? (
          <SettingsEmptyState>Loading connected accounts…</SettingsEmptyState>
        ) : list.length === 0 ? (
          <SettingsEmptyState>No accounts connected for an organization</SettingsEmptyState>
        ) : (
          <>
            {groupByOrganization(list).map(([organizationId, group]) => (
              <SettingsSection key={organizationId} label={group.name}>
                <div className={RESOURCE_LIST_STACK}>
                  {group.accounts.map((account) => {
                    const service = accountService(account)
                    const statusLabel = PERSONAL_ACCOUNT_STATUS_LABELS[account.status]
                    return (
                      <SettingsResourceRow
                        key={account.credentialId}
                        icon={service ? <service.icon /> : undefined}
                        title={account.displayName}
                        description={service?.name ?? account.providerId}
                        badge={
                          statusLabel && (
                            <span className='whitespace-nowrap text-[var(--text-muted)] text-caption'>
                              {statusLabel}
                            </span>
                          )
                        }
                        trailing={
                          account.status !== 'revoked' && (
                            <RowActionsMenu
                              label='Connected account actions'
                              actions={[
                                {
                                  label: 'Disconnect',
                                  destructive: true,
                                  onSelect: () => setPendingDisconnectId(account.credentialId),
                                },
                              ]}
                            />
                          )
                        }
                      />
                    )
                  })}
                </div>
              </SettingsSection>
            ))}
            {accounts.isError && (
              <SettingsQueryErrorState
                error={accounts.error}
                fallback={LOAD_ERROR}
                isRetrying={accounts.isFetching}
                onRetry={() =>
                  accounts.isFetchNextPageError ? accounts.fetchNextPage() : accounts.refetch()
                }
                variant='inline'
              />
            )}
            {accounts.hasNextPage && !accounts.isError && (
              <Chip
                fullWidth
                disabled={accounts.isFetching}
                onClick={() => accounts.fetchNextPage()}
              >
                {accounts.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Chip>
            )}
          </>
        )}
      </SettingsPanel>

      <ChipConfirmModal
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open && !disconnect.isPending) setPendingDisconnectId(null)
        }}
        srTitle='Disconnect account'
        title='Disconnect account'
        text={[
          'Disconnecting ',
          { text: pendingDisconnect?.displayName ?? 'this account', bold: true },
          ' removes it from ',
          { text: pendingDisconnect?.organizationName ?? 'the organization', bold: true },
          '. ',
          { text: 'Workflows using this account will lose access.', error: true },
        ]}
        confirm={{
          label: 'Disconnect',
          onClick: confirmDisconnect,
          pending: disconnect.isPending,
          pendingLabel: 'Disconnecting…',
        }}
      />
    </>
  )
}
