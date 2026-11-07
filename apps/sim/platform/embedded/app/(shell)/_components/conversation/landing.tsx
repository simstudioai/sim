import type { ReactNode } from 'react'
import { Surface } from '@sim/emcn-platform/surface'
import styles from '@/platform/embedded/app/(shell)/_components/conversation/conversation.module.css'

/** The heading of a conversation's or Search's first view, which hangs this far below the view switch. */
export function LandingHeading({ children }: { children: ReactNode }) {
  return (
    <h1 className={styles.landingHeading} data-type='T076'>
      {children}
    </h1>
  )
}

/** What follows the composer on a first view, set clear of it. */
export function LandingFollowUp({ children }: { children: ReactNode }) {
  return <div className={styles.landingGetStarted}>{children}</div>
}

interface ConversationLandingProps {
  heading: string
  /** The composer and whatever follows it. Legacy, so they sit beside the heading's surface. */
  children: ReactNode
}

/** A conversation's first view, on the same lines as the Search view beside it. */
export function ConversationLanding({ heading, children }: ConversationLandingProps) {
  return (
    <main className={styles.landingScroll}>
      <div className={styles.landing}>
        <Surface>
          <LandingHeading>{heading}</LandingHeading>
        </Surface>
        <div className={styles.landingField}>{children}</div>
      </div>
    </main>
  )
}
