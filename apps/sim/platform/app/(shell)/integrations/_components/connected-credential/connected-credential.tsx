'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential.module.css'
import { ActionMenu, Modal } from '@/platform/design-system/components'
import type { IntegrationAccount } from '@/platform/lib/integrations/model'

interface ConnectedCredentialProps {
  account: IntegrationAccount
  status?: string
  canAuthorize: boolean
  onReconnect: () => void
  onDisconnect: () => void
}

export function ConnectedCredential({
  account,
  status,
  canAuthorize,
  onReconnect,
  onDisconnect,
}: ConnectedCredentialProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <section aria-label='Connected credential' className={styles.section}>
      <h2 data-type='T042'>Connected credential</h2>
      <div className={styles.row}>
        <div className={styles.identity}>
          <p data-type='T059'>{account.label}</p>
          {status && (
            <p className={styles.muted} data-type='T050'>
              {status}
            </p>
          )}
        </div>
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
      </div>
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
    </section>
  )
}
