import type { ReactNode } from 'react'
import { Surface } from '@/platform/design-system/components/surface/surface'
import styles from '@/platform/embedded/app/(shell)/_components/conversation/conversation.module.css'

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
        <Surface>
          <h1 className={styles.landingHeading} data-type='T076'>
            {heading}
          </h1>
        </Surface>
        <div className={styles.landingField}>{children}</div>
      </div>
    </div>
  )
}
