import type { ReactNode } from 'react'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import styles from '@/platform/app/(shell)/_components/conversation/conversation.module.css'
import searchStyles from '@/platform/app/(shell)/search/_components/search-surface/search-surface.module.css'

interface ConversationLandingProps {
  heading: string
  /** The composer and whatever follows it. Legacy, so they sit beside the heading's surface. */
  children: ReactNode
}

/** A conversation's first view, on the same lines as the Search view beside it. */
export function ConversationLanding({ heading, children }: ConversationLandingProps) {
  return (
    <div className={styles.landingScroll}>
      <div className={styles.landing}>
        <RedesignSurface>
          <h1 className={searchStyles.heading} data-type='T076'>
            {heading}
          </h1>
        </RedesignSurface>
        <div className={styles.landingField}>{children}</div>
      </div>
    </div>
  )
}
