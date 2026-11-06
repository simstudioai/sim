import type { ReactNode } from 'react'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import styles from '@/platform/app/(shell)/_components/conversation/conversation.module.css'

/** The transcript's shape while its history loads. It sits in the thread's own scroller. */
export function TranscriptPlaceholder() {
  return (
    <div className={styles.transcriptSkeleton}>
      <RedesignSurface>
        <div role='status' aria-label='Loading conversation' aria-busy='true'>
          <div className={styles.transcriptBubble} />
          <div className={styles.transcriptLines}>
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </RedesignSurface>
    </div>
  )
}

/** Holds the composer's place in the thread's footer. */
export function ComposerPlaceholder() {
  return (
    <div className={styles.composerSkeleton}>
      <RedesignSurface>
        <div className={styles.placeholderComposer} />
      </RedesignSurface>
    </div>
  )
}

/** The band a Search surface's view switch sits in, kept while there is none so nothing moves. */
function HeaderBand({ header }: { header?: ReactNode }) {
  return (
    <div className={`${styles.headerBand} ${RESOURCE_HEADER_CLASSES.layout}`}>
      <div className={RESOURCE_HEADER_CLASSES.content}>{header}</div>
    </div>
  )
}

interface ConversationSkeletonProps {
  /** Search's view switch; `null` holds its band for a route that has not mounted one yet. */
  header?: ReactNode
}

/** A saved conversation before it can mount, in the thread's own frame. */
export function ConversationSkeleton({ header }: ConversationSkeletonProps) {
  return (
    <div className={styles.skeleton}>
      {header !== undefined && <HeaderBand header={header} />}
      <div className={styles.transcriptFrame}>
        <TranscriptPlaceholder />
      </div>
      <div className={styles.composerFrame}>
        <ComposerPlaceholder />
      </div>
    </div>
  )
}

/** Search's docked results before they can mount: only the band holds still, as the rows vary. */
export function ResultsSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy='true'>
      <HeaderBand />
    </div>
  )
}

interface LandingSkeletonProps {
  /** Which field the landing will show, and so how far the placeholder reaches. */
  field: 'search' | 'composer'
  header?: ReactNode
}

/** Search's and Assistant's shared landing before it can mount. */
export function LandingSkeleton({ field, header }: LandingSkeletonProps) {
  return (
    <div className={styles.skeleton} aria-busy='true'>
      <HeaderBand header={header} />
      <div className={styles.landingScroll}>
        <div className={styles.landing}>
          <RedesignSurface>
            <div className={styles.placeholderHeading} />
          </RedesignSurface>
          <div className={styles.landingField}>
            <RedesignSurface>
              <div
                className={
                  field === 'composer' ? styles.placeholderComposer : styles.placeholderField
                }
              />
            </RedesignSurface>
          </div>
        </div>
      </div>
    </div>
  )
}
