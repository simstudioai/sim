'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipModalError,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { MoreHorizontal } from '@sim/emcn/icons'
import Link from 'next/link'
import type { ViewerSearchSourceAccount } from '@/lib/api/contracts/knowledge/connectors'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useDisconnectPersonalOrganizationAccount } from '@/hooks/queries/organization-accounts'

interface AccountActionsMenuProps {
  organizationId: string
  integrationName: string
  accounts: ViewerSearchSourceAccount[]
  onConnect?: () => void
  onReconnect: (credentialId: string) => void
  connectionPending: boolean
  connecting: boolean
  connectionReady: boolean
  permissionAccountIds: readonly string[]
  reconnectAccountIds: readonly string[]
}

export function AccountActionsMenu({
  organizationId,
  integrationName,
  accounts,
  onConnect,
  onReconnect,
  connectionPending,
  connecting,
  connectionReady,
  permissionAccountIds,
  reconnectAccountIds,
}: AccountActionsMenuProps) {
  const disconnect = useDisconnectPersonalOrganizationAccount(organizationId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = accounts.find((account) => account.credentialId === selectedId)
  const permissionAccounts = accounts.filter((account) =>
    permissionAccountIds.includes(account.credentialId)
  )
  const hasAccountActions = accounts.length > 0
  const pending = connectionPending || disconnect.isPending
  if (!accounts.length && !onConnect) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip leftIcon={MoreHorizontal} aria-label={`${integrationName} integration actions`} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          {permissionAccounts.map((account) => (
            <DropdownMenuItem key={`permissions-${account.credentialId}`} asChild>
              <Link
                href={organizationRoutes(organizationId).accountToolPermissions(
                  account.credentialId
                )}
              >
                <DropdownMenuItemLabel
                  label={`Tool permissions${accounts.length > 1 ? ` · ${account.displayName}` : ''}`}
                />
              </Link>
            </DropdownMenuItem>
          ))}
          {accounts.map((account) => (
            <DropdownMenuItem
              key={`reconnect-${account.credentialId}`}
              disabled={pending || !reconnectAccountIds.includes(account.credentialId)}
              onSelect={() => onReconnect(account.credentialId)}
            >
              Reconnect{accounts.length > 1 ? ` · ${account.displayName}` : ''}
            </DropdownMenuItem>
          ))}
          {hasAccountActions && onConnect && <DropdownMenuSeparator />}
          {onConnect && (
            <DropdownMenuItem disabled={pending || !connectionReady} onSelect={onConnect}>
              {connecting ? 'Connecting' : accounts.length ? 'Add account' : 'Connect'}
            </DropdownMenuItem>
          )}
          {hasAccountActions && <DropdownMenuSeparator />}
          {accounts.map((account) => (
            <DropdownMenuItem
              key={`disconnect-${account.credentialId}`}
              disabled={pending}
              className='text-[var(--text-error)]'
              onSelect={() => {
                disconnect.reset()
                setSelectedId(account.credentialId)
              }}
            >
              Disconnect{accounts.length > 1 ? ` · ${account.displayName}` : ''}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ChipConfirmModal
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !disconnect.isPending) setSelectedId(null)
        }}
        title={`Disconnect ${integrationName}`}
        text={`Disconnect ${selected?.displayName ?? integrationName} from all ${integrationName} connections in this organization. Workflows using this account will also lose access. You can reconnect later.`}
        confirm={{
          label: 'Disconnect',
          pendingLabel: 'Disconnecting',
          pending: disconnect.isPending,
          disabled: disconnect.isPending,
          onClick: () => {
            if (!selected || disconnect.isPending) return
            disconnect.mutate(selected.credentialId, { onSuccess: () => setSelectedId(null) })
          },
        }}
      >
        <ChipModalError>{disconnect.error?.message}</ChipModalError>
      </ChipConfirmModal>
    </>
  )
}
