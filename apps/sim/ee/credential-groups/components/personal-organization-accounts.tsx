'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalError, ChipTag, toast } from '@sim/emcn'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  useDisconnectPersonalOrganizationAccount,
  usePersonalOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
} from '@/hooks/queries/organization-accounts'

export function PersonalOrganizationAccounts() {
  const accounts = usePersonalOrganizationAccounts()
  const reconnect = useReconnectPersonalOrganizationAccount()
  const disconnect = useDisconnectPersonalOrganizationAccount()
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const disconnectingAccount = accounts.data?.pages
    .flatMap((page) => page.accounts)
    .find((account) => account.credentialId === disconnectingId)
  const pending = reconnect.isPending || disconnect.isPending
  const error = reconnect.error ?? disconnect.error
  return (
    <SettingsPanel>
      <div className='flex flex-col gap-4'>
        <p className='text-[var(--text-muted)] text-small'>
          These are accounts you contributed to organizations. Disconnecting stops their workflows
          from using that account. Organization admins control which workspaces can use the shared
          pool.
        </p>
        {error && (
          <p role='alert' className='text-[var(--text-error)] text-caption'>
            {error.message}
          </p>
        )}
        {accounts.error ? (
          <SettingsQueryErrorState
            error={accounts.error}
            fallback='Could not load your connected accounts'
            isRetrying={accounts.isFetching}
            onRetry={() => void accounts.refetch()}
          />
        ) : accounts.isPending ? (
          <p className='text-[var(--text-muted)] text-caption'>Loading your accounts…</p>
        ) : (
          accounts.data?.pages
            .flatMap((page) => page.accounts)
            .map((account) => (
              <SettingsResourceRow
                key={account.credentialId}
                title={account.displayName}
                description={`${account.organizationName} · ${account.providerId}${account.kind === 'mcp' ? ' (MCP)' : ''}`}
                badge={
                  <ChipTag>
                    {account.enrollmentStatus === 'revoked' ? 'Access revoked' : account.status}
                  </ChipTag>
                }
                trailing={
                  <div className='flex gap-2'>
                    <Chip
                      disabled={pending || !account.canReconnect}
                      onClick={() =>
                        reconnect.mutate(account.credentialId, {
                          onSuccess: ({ invitationLink }) => {
                            window.location.assign(invitationLink)
                          },
                        })
                      }
                    >
                      Reconnect
                    </Chip>
                    <Chip
                      variant='destructive'
                      disabled={pending || account.status === 'revoked'}
                      onClick={() => {
                        disconnect.reset()
                        setDisconnectingId(account.credentialId)
                      }}
                    >
                      Disconnect
                    </Chip>
                  </div>
                }
              />
            ))
        )}
        {accounts.data?.pages[0]?.accounts.length === 0 && (
          <p className='text-[var(--text-muted)] text-caption'>
            You haven’t contributed accounts to an organization yet. Use your invitation link to get
            started.
          </p>
        )}
        {accounts.hasNextPage && (
          <div>
            <Chip
              disabled={accounts.isFetchingNextPage}
              onClick={() => void accounts.fetchNextPage()}
            >
              Load more
            </Chip>
          </div>
        )}
        {disconnectingAccount && (
          <ChipConfirmModal
            open
            onOpenChange={(open) => {
              if (!open && !disconnect.isPending) setDisconnectingId(null)
            }}
            title={`Disconnect ${disconnectingAccount.displayName}`}
            text={`${disconnectingAccount.organizationName} workflows will no longer be able to use this account.`}
            defaultAction='none'
            confirm={{
              label: 'Disconnect',
              pendingLabel: 'Disconnecting…',
              pending: disconnect.isPending,
              variant: 'destructive',
              onClick: () =>
                disconnect.mutate(disconnectingAccount.credentialId, {
                  onSuccess: () => {
                    setDisconnectingId(null)
                    toast.success('Account disconnected')
                  },
                }),
            }}
          >
            <ChipModalError>{disconnect.error?.message}</ChipModalError>
          </ChipConfirmModal>
        )}
      </div>
    </SettingsPanel>
  )
}
