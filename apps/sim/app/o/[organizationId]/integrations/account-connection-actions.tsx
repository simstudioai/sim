'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalError } from '@sim/emcn'
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
  return (
    <>
      {account && (
        <Chip disabled={pending || !canReconnect} onClick={onReconnect}>
          Reconnect
        </Chip>
      )}
      {onConnect && (
        <Chip disabled={pending || !canConnect} onClick={onConnect}>
          {connectLabel}
        </Chip>
      )}
      {account && (
        <>
          <Chip
            disabled={pending}
            onClick={() => {
              disconnect.reset()
              setConfirming(true)
            }}
          >
            Disconnect
          </Chip>
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
        </>
      )}
    </>
  )
}
