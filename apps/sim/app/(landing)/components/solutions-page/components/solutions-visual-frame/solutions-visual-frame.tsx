import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { SOLUTIONS_VISUAL } from '@/app/(landing)/components/solutions-page/constants'

/**
 * The one escape hatch in the solutions layout - a fixed-dimension frame that
 * holds a page-supplied visual `ReactNode`. The frame owns its chrome (the
 * hero-visual family: `--surface-2` fill, `--border-1` hairline, `rounded-lg`,
 * `overflow-hidden`) and, crucially, its dimensions: it reserves a full-width
 * 16:9 aspect ratio for the solutions hero visual. Because the size is reserved
 * before paint and the node fills `h-full w-full` inside, a dropped-in node can
 * neither shift surrounding layout (CLS = 0) nor change the frame's own padding.
 *
 * The frame is decorative chrome around product visuals, so it is `aria-hidden`;
 * the page's meaning lives in the adjacent headings and copy.
 */

interface SolutionsVisualFrameProps {
  /** The page-supplied visual island or static panel. Fills the frame; owns no chrome. */
  children: ReactNode
}

export function SolutionsVisualFrame({ children }: SolutionsVisualFrameProps) {
  return (
    <div
      aria-hidden='true'
      className={cn(
        'w-full overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)]',
        SOLUTIONS_VISUAL.heroAspect
      )}
    >
      <div className='h-full w-full'>{children}</div>
    </div>
  )
}
