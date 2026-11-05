import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page.module.css'
import { Chip } from '@/platform/design-system/components/button/button'

interface IntegrationsPageProps {
  /** A detail page's way back. The index has none. */
  back?: { href: string; label: string }
  children: ReactNode
}

export function IntegrationsPage({ back, children }: IntegrationsPageProps) {
  return (
    <main className={styles.page}>
      {back && (
        <nav aria-label='Integration navigation' className={styles.back}>
          <Chip href={back.href} icon='I093'>
            {back.label}
          </Chip>
        </nav>
      )}
      {children}
    </main>
  )
}

interface IntegrationsHeadingProps {
  /** Actions for a flow the member arrived through, such as returning to Slack. */
  handoff?: ReactNode
}

export function IntegrationsHeading({ handoff }: IntegrationsHeadingProps) {
  return (
    <header className={styles.heading}>
      <h1 data-type='T076'>Integrations</h1>
      <p data-type='T060'>
        Connect your accounts to the integrations your organization makes available.
      </p>
      {handoff}
    </header>
  )
}
