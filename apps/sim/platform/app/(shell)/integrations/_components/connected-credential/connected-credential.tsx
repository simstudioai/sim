import type { ComponentType } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { CountedLabel } from '@sim/emcn/overflow-text/counted-label'
import { BrandMark } from '@/platform/app/(shell)/_components/brand-mark/brand-mark'
import styles from '@/platform/app/(shell)/integrations/_components/connected-credential/connected-credential.module.css'
import { credentialDescription } from '@/platform/lib/integrations/credential-display'
import type { IntegrationAccount } from '@/platform/shared/integrations'

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
            leading={<BrandMark providerId={providerId} icon={icon} />}
            title={account.label}
            detail={credentialDescription(account)}
          />
        ))}
      </ul>
    </section>
  )
}
