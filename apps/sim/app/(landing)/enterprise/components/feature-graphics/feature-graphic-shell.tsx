import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

/**
 * `tile` is the solutions/platform feature-tile crop (right-bleed, 420px cap).
 * `portrait` fills a tall homepage bloc with no bleed cap.
 */
export type FeatureGraphicVariant = 'tile' | 'portrait'

interface FeatureGraphicShellProps {
  children: ReactNode
  variant?: FeatureGraphicVariant
}

/**
 * Shared crop canvas for platform-faithful enterprise feature previews.
 *
 * The `420px` cap keeps graphics at their designed measure on wide fluid
 * tiles (single-column phones, 2-up desktop rows). When the tile is the
 * full-width spanned card of a 3-card row in the two-column band (see
 * `SolutionsCard`'s `tabletSpan` - the only case where a tile's query
 * container reaches 500px inside `sm`..`lg`), the cap lifts so window-chrome
 * graphics keep bleeding off the tile's right edge and centered vignettes
 * center on the true wide slot.
 *
 * Homepage portrait blocs pass {@link FeatureGraphicVariant} `portrait` so
 * the shell fills the tall stage instead of the tile's bleed crop.
 */
export function FeatureGraphicShell({ children, variant = 'tile' }: FeatureGraphicShellProps) {
  const portrait = variant === 'portrait'

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden',
        !portrait &&
          'mx-auto min-h-[260px] max-w-[420px] sm:max-lg:[@container(min-width:500px)]:max-w-none'
      )}
    >
      <div className={cn('relative h-full', !portrait && 'min-h-[260px]')}>{children}</div>
    </div>
  )
}
