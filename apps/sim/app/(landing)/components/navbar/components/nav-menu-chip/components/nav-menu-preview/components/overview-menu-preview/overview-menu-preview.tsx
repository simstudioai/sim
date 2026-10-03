import { cn } from '@sim/emcn'
import styles from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/overview-menu-preview/overview-menu-preview.module.css'
import {
  IsoIntegrateIllustration,
  IsoMonitorIllustration,
} from '@/app/(landing)/components/platform-suite/components/iso-marks'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'

interface OverviewMenuPreviewProps {
  layout?: 'menu' | 'hero'
}

/** The homepage's Build and Govern marks, reduced to a quiet row of drawn contours. */
export function OverviewMenuPreview({ layout = 'menu' }: OverviewMenuPreviewProps) {
  const isHero = layout === 'hero'

  return (
    <div
      aria-hidden='true'
      inert
      data-menu-preview='overview'
      className={cn(
        'pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden px-10 [container-type:inline-size]',
        isHero ? 'gap-24 bg-[var(--bg)] max-sm:gap-10 max-sm:px-6' : 'gap-10 bg-[var(--surface-3)]'
      )}
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
      {isHero && <EdgeFade ground='canvas' depth='preview' />}
    </div>
  )
}
