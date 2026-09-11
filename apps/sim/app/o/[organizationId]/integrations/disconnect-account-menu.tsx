'use client'

import { useState } from 'react'
import { ChipConfirmModal, ChipModalError } from '@sim/emcn'
import type { ViewerSearchSourceAccount } from '@/lib/api/contracts/knowledge/connectors'
import {
  type RowAction,
  RowActionsMenu,
} from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { useDisconnectPersonalOrganizationAccount } from '@/hooks/queries/organization-accounts'

interface DisconnectAccountMenuProps {
  organizationId: string
  integrationName: string
  accounts: ViewerSearchSourceAccount[]
  accountLabels?: ReadonlyMap<string, string>
  actions?: RowAction[]
}

/** Disconnect is independent of provider availability, reconnect state, and indexing activity. */
export function DisconnectAccountMenu({
  organizationId,
  integrationName,
  accounts,
  accountLabels,
  actions = [],
}: DisconnectAccountMenuProps) {
  const disconnect = useDisconnectPersonalOrganizationAccount(organizationId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = accounts.find((account) => account.credentialId === selectedId)
  const accountLabel = (account: ViewerSearchSourceAccount) =>
    accountLabels?.get(account.credentialId) ?? account.displayName
  if (!accounts.length && !actions.length) return null

  return (
    <>
      <RowActionsMenu
        label={`${integrationName} integration actions`}
        actions={[
          ...actions,
          ...accounts.map((account) => ({
            label: accounts.length === 1 ? 'Disconnect' : `Disconnect ${accountLabel(account)}`,
            tooltip: accounts.length > 1 ? `Disconnect ${accountLabel(account)}` : undefined,
            destructive: true,
            disabled: disconnect.isPending,
            onSelect: () => {
              disconnect.reset()
              setSelectedId(account.credentialId)
            },
          })),
        ]}
      />
      <ChipConfirmModal
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !disconnect.isPending) setSelectedId(null)
        }}
        title={`Disconnect ${integrationName}`}
        text={`Disconnect ${selected ? accountLabel(selected) : integrationName} from all ${integrationName} connections in this organization. Workflows using this account will also lose access. You can reconnect later.`}
        confirm={{
          label: 'Disconnect',
          pendingLabel: 'Disconnecting…',
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
