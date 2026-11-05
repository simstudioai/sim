'use client'

import { useState } from 'react'
import { ActionMenu, Modal } from '@/platform/design-system/components'
import type { IntegrationAccount } from '@/platform/lib/integrations/model'

interface CredentialActionsProps {
  account: IntegrationAccount
  canAuthorize: boolean
  onReconnect: () => void
  onDisconnect: () => void
}

export function CredentialActions({
  account,
  canAuthorize,
  onReconnect,
  onDisconnect,
}: CredentialActionsProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <ActionMenu
        label={`Manage ${account.label}`}
        icon='I108'
        triggerSize='row'
        align='end'
        tooltip={false}
        actions={[
          ...(account.canReconnect
            ? [
                {
                  id: 'reconnect',
                  label: 'Reconnect account',
                  disabled: !canAuthorize,
                  onSelect: onReconnect,
                },
              ]
            : []),
          {
            id: 'disconnect',
            label: 'Disconnect account',
            destructive: true,
            separatorBefore: account.canReconnect,
            onSelect: () => setConfirming(true),
          },
        ]}
      />
      {confirming && (
        <Modal
          open
          onOpenChange={setConfirming}
          title='Disconnect account?'
          variant='confirm'
          destructive
          description={`Sim will lose access to ${account.label}.`}
          confirmLabel='Disconnect'
          onConfirm={onDisconnect}
        />
      )}
    </>
  )
}
