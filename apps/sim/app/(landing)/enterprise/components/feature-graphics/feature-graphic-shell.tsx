import type { ReactNode } from 'react'

interface FeatureGraphicShellProps {
  children: ReactNode
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
 */
export function FeatureGraphicShell({ children }: FeatureGraphicShellProps) {
  return (
    <div className='relative mx-auto h-full min-h-[260px] w-full max-w-[420px] overflow-hidden sm:max-lg:[@container(min-width:500px)]:max-w-none'>
      <div className='relative h-full min-h-[260px]'>{children}</div>
    </div>
  )
}
