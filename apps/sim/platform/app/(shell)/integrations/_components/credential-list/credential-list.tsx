import { ActivityRow } from '@sim/emcn/activity-row'
import { CountedLabel } from '@sim/emcn/overflow-text/counted-label'
import styles from '@/platform/app/(shell)/integrations/_components/credential-list/credential-list.module.css'
import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import { credentialDescription } from '@/platform/lib/integrations/credential-display'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

interface CredentialListProps {
  /**
   * The app whose page lists these credentials. Every row wears its mark, even a shared Google
   * credential first linked to another app.
   */
  providerId: string
  credentials: readonly IntegrationCredential[]
  onOpen: (credential: IntegrationCredential) => void
}

export function CredentialList({ providerId, credentials, onOpen }: CredentialListProps) {
  return (
    <section className={styles.section} aria-label='Connected credentials'>
      <h2 data-type='T093'>
        <CountedLabel label='Connected credentials' count={credentials.length} />
      </h2>
      {credentials.length > 0 ? (
        <ul className={styles.list}>
          {credentials.map((credential) => (
            <ActivityRow
              key={credential.id}
              leading={<IntegrationMark providerId={providerId} />}
              title={credential.displayName}
              detail={credentialDescription(credential)}
              onOpen={() => onOpen(credential)}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.empty} data-type='T060'>
          No connected credentials
        </p>
      )}
    </section>
  )
}
