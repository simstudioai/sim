'use client'

import { useState } from 'react'
import { ChipConfirmModal, ChipModalError } from '@sim/emcn'
import { type SettingsAction, SettingsActionChips } from '@/components/settings/settings-header'
import type { ViewerSearchSourceAccount } from '@/lib/api/contracts/knowledge/connectors'
import { useDisconnectPersonalOrganizationAccount } from '@/hooks/queries/organization-accounts'

interface AccountConnectionActionsProps {
  organizationId: string
  integrationName: string
  account?: ViewerSearchSourceAccount
  onConnect?: () => void
  connectLabel: 'Connect' | 'Add account'
  onReconnect: () => void
  canReconnect: boolean
  canConnect: boolean
  connectionPending: boolean
}

/** Header actions act on the selected account; adding a connection uses its available slot. */
export function AccountConnectionActions({
  organizationId,
  integrationName,
  account,
  onConnect,
  connectLabel,
  onReconnect,
  canReconnect,
  canConnect,
  connectionPending,
}: AccountConnectionActionsProps) {
  const disconnect = useDisconnectPersonalOrganizationAccount(organizationId)
  const [confirming, setConfirming] = useState(false)
  const pending = connectionPending || disconnect.isPending
  const actions: SettingsAction[] = []
  if (account) {
    actions.push({
      id: 'reconnect',
      text: 'Reconnect',
      disabled: pending || !canReconnect,
      onSelect: onReconnect,
    })
  }
  if (onConnect) {
    actions.push({
      id: 'connect',
      text: connectLabel,
      variant: 'primary',
      disabled: pending || !canConnect,
      onSelect: onConnect,
    })
  }
  if (account) {
    actions.push({
      id: 'delete',
      text: 'Disconnect',
      disabled: pending,
      onSelect: () => {
        disconnect.reset()
        setConfirming(true)
      },
    })
  }
  return (
    <>
      <SettingsActionChips actions={actions} />
      {account && (
        <ChipConfirmModal
          open={confirming}
          onOpenChange={(open) => {
            if (!disconnect.isPending) setConfirming(open)
          }}
          title={`Disconnect ${integrationName}`}
          text={`Disconnect ${account.displayName} from all ${integrationName} connections in this organization. Workflows using this account will also lose access. You can reconnect later.`}
          confirm={{
            label: 'Disconnect',
            pendingLabel: 'Disconnecting',
            pending: disconnect.isPending,
            disabled: disconnect.isPending,
            onClick: () =>
              disconnect.mutate(account.credentialId, { onSuccess: () => setConfirming(false) }),
          }}
        >
          <ChipModalError>{disconnect.error?.message}</ChipModalError>
        </ChipConfirmModal>
      )}
    </>
  )
}
