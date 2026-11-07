import type { ComponentType } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { CountedLabel } from '@sim/emcn/overflow-text/counted-label'
import styles from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential.module.css'
import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import type { IntegrationAccount } from '@/platform/lib/data/integrations-types'
import { credentialDescription } from '@/platform/lib/integrations/credential-display'

interface CredentialRow extends IntegrationAccount {
  href: string
}

interface ConnectedCredentialProps {
  providerId: string
  icon?: ComponentType<{ className?: string }>
  accounts: readonly CredentialRow[]
}

export function ConnectedCredential({ providerId, icon, accounts }: ConnectedCredentialProps) {
  const heading = accounts.length > 1 ? 'Connected credentials' : 'Connected credential'
  return (
    <section aria-label={heading} className={styles.section}>
      <h2 data-type='T093'>
        <CountedLabel label={heading} count={accounts.length} />
      </h2>
      <ul className={styles.rows}>
        {accounts.map((account) => (
          <ActivityRow
            key={account.id}
            href={account.href}
            leading={<IntegrationMark providerId={providerId} icon={icon} />}
            title={account.label}
            detail={credentialDescription(account)}
          />
        ))}
      </ul>
    </section>
  )
}
