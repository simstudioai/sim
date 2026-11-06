'use client'

import { useState } from 'react'
import Link from 'next/link'
import styles from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential.module.css'
import { Button } from '@/platform/design-system/components/button/button'
import { ActionMenu } from '@/platform/design-system/components/menu/action-menu'
import { ConfirmDialog } from '@/platform/design-system/components/modal/confirm-dialog'
import type { IntegrationAccount } from '@/platform/lib/integrations/model'

interface CredentialRow extends IntegrationAccount {
  statusLabel: string
  /** Opens this account's permissions when the integration lists several. */
  href?: string
}

interface ConnectedCredentialProps {
  integrationName: string
  accounts: readonly CredentialRow[]
  pending: boolean
  /** Connects a further account into a free slot, when the organization offers one. */
  addAccount?: { disabled: boolean; onSelect: () => void }
  onReconnect: (accountId: string) => void
  onDisconnect: (accountId: string) => Promise<unknown>
}

export function ConnectedCredential({
  integrationName,
  accounts,
  pending,
  addAccount,
  onReconnect,
  onDisconnect,
}: ConnectedCredentialProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirming = accounts.find((account) => account.id === confirmingId)
  const heading = accounts.length > 1 ? 'Connected credentials' : 'Connected credential'
  return (
    <section aria-label={heading} className={styles.section}>
      <h2 data-type='T093'>{heading}</h2>
      {accounts.map((account) => (
        <div key={account.id} className={styles.row}>
          <div className={styles.identity}>
            {account.href ? (
              <Link href={account.href} className={styles.link} data-type='T059'>
                {account.label}
              </Link>
            ) : (
              <p data-type='T059'>{account.label}</p>
            )}
            <p className={styles.muted} data-type='T050'>
              {account.statusLabel}
            </p>
          </div>
          <ActionMenu
            label={`Manage ${account.label}`}
            icon='I108'
            triggerSize='row'
            align='end'
            tooltip={false}
            actions={[
              {
                id: 'reconnect',
                label: 'Reconnect account',
                disabled: pending || !account.canReconnect,
                onSelect: () => onReconnect(account.id),
              },
              {
                id: 'disconnect',
                label: 'Disconnect account',
                destructive: true,
                separatorBefore: true,
                disabled: pending,
                onSelect: () => setConfirmingId(account.id),
              },
            ]}
          />
        </div>
      ))}
      {addAccount && (
        <div>
          <Button disabled={pending || addAccount.disabled} onClick={addAccount.onSelect}>
            Add account
          </Button>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          target
          onClose={() => setConfirmingId(null)}
          title={`Disconnect ${integrationName}`}
          description={`Disconnect ${confirming.label} from all ${integrationName} connections in this organization. Workflows using this account will also lose access. You can reconnect later.`}
          confirmLabel='Disconnect'
          pendingLabel='Disconnecting…'
          onConfirm={() => onDisconnect(confirming.id)}
        />
      )}
    </section>
  )
}
