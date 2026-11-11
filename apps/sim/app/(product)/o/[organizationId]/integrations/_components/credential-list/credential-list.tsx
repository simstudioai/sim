import { ActivityRow } from '@sim/emcn/activity-row'
import { EmptyState } from '@sim/emcn/empty-state'
import { CountedLabel } from '@sim/emcn/overflow-text/counted-label'
import { PageOverflow } from '@sim/emcn-platform/page-column'
import { BrandMark } from '@/app/(product)/_components/brand-mark/brand-mark'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/credential-list/credential-list.module.css'
import { credentialDescription } from '@/platform/lib/integrations/credential-display'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

type CredentialListProps = {
  /**
   * The app whose page lists these credentials. Every row wears its mark, even a shared Google
   * credential first linked to another app.
   */
  providerId: string
  credentials: readonly IntegrationCredential[]
} & (
  | {
      /** Each row's own address, so a live row is a link. */
      credentialHref: (credential: IntegrationCredential) => string
      onOpen?: never
    }
  | { credentialHref?: never; onOpen: (credential: IntegrationCredential) => void }
)

export function CredentialList({
  providerId,
  credentials,
  credentialHref,
  onOpen,
}: CredentialListProps) {
  return (
    <section className={styles.section} aria-label='Connected credentials'>
      <h2 data-type='T093'>
        <CountedLabel label='Connected credentials' count={credentials.length} />
      </h2>
      {credentials.length > 0 ? (
        <PageOverflow>
          <ul className={styles.list}>
            {credentials.map((credential) =>
              credentialHref ? (
                <ActivityRow
                  key={credential.id}
                  leading={<BrandMark providerId={providerId} />}
                  title={credential.displayName}
                  detail={credentialDescription(credential)}
                  href={credentialHref(credential)}
                />
              ) : (
                <ActivityRow
                  key={credential.id}
                  leading={<BrandMark providerId={providerId} />}
                  title={credential.displayName}
                  detail={credentialDescription(credential)}
                  onOpen={() => onOpen(credential)}
                />
              )
            )}
          </ul>
        </PageOverflow>
      ) : (
        <EmptyState title='No connected credentials' />
      )}
    </section>
  )
}
