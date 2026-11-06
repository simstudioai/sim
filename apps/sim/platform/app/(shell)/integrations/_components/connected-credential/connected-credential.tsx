'use client'

import { type ComponentType, useState } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential.module.css'
import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import { ActionMenu, ActivityRow, Modal } from '@/platform/design-system/components'
import { ActivityBody } from '@/platform/design-system/components/activity-row/activity-body'
import { CountedLabel } from '@/platform/design-system/components/overflow-text/counted-label'
import type { IntegrationAccount } from '@/platform/lib/data/integrations-types'
import { credentialDescription } from '@/platform/lib/integrations/credential-display'

interface CredentialRow extends IntegrationAccount {
  /** Opens this account's permissions when the integration lists several. */
  href?: string
}

interface ConnectedCredentialProps {
  integrationName: string
  providerId: string
  icon?: ComponentType<{ className?: string }>
  accounts: readonly CredentialRow[]
  pending: boolean
  onReconnect: (accountId: string) => void
  onDisconnect: (accountId: string) => Promise<unknown>
}

export function ConnectedCredential({
  integrationName,
  providerId,
  icon,
  accounts,
  pending,
  onReconnect,
  onDisconnect,
}: ConnectedCredentialProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirming = accounts.find((account) => account.id === confirmingId)
  const heading = accounts.length > 1 ? 'Connected credentials' : 'Connected credential'
  return (
    <section aria-label={heading} className={styles.section}>
      <h2 data-type='T093'>
        <CountedLabel label={heading} count={accounts.length} />
      </h2>
      <ul className={styles.rows}>
        {accounts.map((account) => {
          const action = (
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
          )
          return account.href ? (
            <ActivityRow
              key={account.id}
              href={account.href}
              leading={<IntegrationMark providerId={providerId} icon={icon} />}
              title={account.label}
              detail={credentialDescription(account)}
            />
          ) : (
            <li key={account.id} className={styles.row}>
              <ActivityBody leading={<IntegrationMark providerId={providerId} icon={icon} />}>
                <span data-type='T059'>{account.label}</span>
                <span className={styles.muted} data-type='T050'>
                  {credentialDescription(account)}
                </span>
              </ActivityBody>
              {action}
            </li>
          )
        })}
      </ul>
      {confirming && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setConfirmingId(null)
          }}
          title={`Disconnect ${integrationName}`}
          variant='confirm'
          destructive
          description={`Disconnect ${confirming.label} from all ${integrationName} connections in this organization. Workflows using this account will also lose access. You can reconnect later.`}
          confirmLabel='Disconnect'
          onConfirm={() => onDisconnect(confirming.id)}
        />
      )}
    </section>
  )
}
