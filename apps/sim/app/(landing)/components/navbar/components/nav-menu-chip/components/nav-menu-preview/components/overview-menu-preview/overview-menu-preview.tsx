import { cn } from '@sim/emcn'
import styles from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/overview-menu-preview/overview-menu-preview.module.css'
import {
  IsoIntegrateIllustration,
  IsoMonitorIllustration,
} from '@/app/(landing)/components/platform-suite/components/iso-marks'

/** The homepage's Build and Govern marks, reduced to a quiet row of drawn contours. */
export function OverviewMenuPreview() {
  return (
    <div
      aria-hidden='true'
      inert
      data-menu-preview='overview'
      className='pointer-events-none absolute inset-0 flex select-none items-center justify-center gap-10 overflow-hidden bg-[var(--surface-3)] px-10 [container-type:inline-size]'
    >
      <IsoIntegrateIllustration
        size={212}
        variant='outline'
        className={cn('size-[min(33cqw,212px)]', styles.mark)}
      />
      <IsoMonitorIllustration
        size={212}
        variant='outline'
        className={cn('size-[min(33cqw,212px)]', styles.mark, styles.second)}
      />
    </div>
  )
}
