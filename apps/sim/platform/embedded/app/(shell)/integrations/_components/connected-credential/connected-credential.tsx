'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import Link from 'next/link'
import styles from '@/platform/embedded/app/(shell)/integrations/_components/connected-credential/connected-credential.module.css'
import type { IntegrationAccount } from '@/platform/shared/integrations'

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
  const heading = accounts.length > 1 ? 'Connected accounts' : 'Connected account'
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
            {accounts.length === 1 && account.sites.length > 0 && (
              <ul aria-label={`Sites ${account.label} reaches`} className={styles.sites}>
                {account.sites.map((site) => (
                  <li key={site.url} data-type='T050'>
                    {site.name}{' '}
                    <span className={styles.muted}>{site.url.replace(/^https:\/\//, '')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.actions}>
            {account.status === 'needs_reauth' && account.canReconnect && (
              <Button
                size='compact'
                disabled={pending}
                aria-label={`Reconnect ${account.label}`}
                onClick={() => onReconnect(account.id)}
              >
                Reconnect
              </Button>
            )}
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
          description={`Disconnect ${confirming.label} from this organization. Workflows using this account will also lose access. You can reconnect later.`}
          confirmLabel='Disconnect'
          pendingLabel='Disconnecting…'
          onConfirm={() => onDisconnect(confirming.id)}
        />
      )}
    </section>
  )
}
