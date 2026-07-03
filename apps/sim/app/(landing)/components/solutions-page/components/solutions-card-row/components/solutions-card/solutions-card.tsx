import { cn } from '@sim/emcn'
import { SolutionsVisualFrame } from '@/app/(landing)/components/solutions-page/components/solutions-visual-frame'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsCardConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * A single solutions card - an `<article>` with an `<h3>` title, a body-color
 * description, and a reserved visual panel beneath. Text sits directly on the
 * canvas (matching the hero and every other landing section); only the visual
 * carries the `--surface-2` panel chrome, so the product mock reads as the one
 * elevated surface and never blends into a competing card fill.
 *
 * The card owns the gap between its text and visual (`cardTextToVisual`) and the
 * title→description stack (`cardTextStack`) - both from named spacing constants.
 * The text block grows (`flex-1`) so the visual pins to the bottom of the
 * grid-stretched cell: every card's visual aligns on one baseline regardless of
 * description length. The visual lands in a fixed-height {@link SolutionsVisualFrame}
 * so the row stays uniform and CLS is zero.
 *
 * A content unit only: it accepts copy and a visual node, never any layout knob.
 */

interface SolutionsCardProps {
  card: SolutionsCardConfig
  /** Stable id wiring the `<h3>` into the page outline. */
  headingId: string
}

export function SolutionsCard({ card, headingId }: SolutionsCardProps) {
  return (
    <article className={cn('flex h-full flex-col', SOLUTIONS_SPACING.cardTextToVisual)}>
      <div className={cn('flex flex-1 flex-col', SOLUTIONS_SPACING.cardTextStack)}>
        <h3 id={headingId} className='text-[18px] text-[var(--text-primary)] leading-[1.3]'>
          {card.title}
        </h3>
        <p className='text-[15px] text-[var(--text-body)] leading-[1.5]'>{card.description}</p>
      </div>

      <SolutionsVisualFrame size='card'>{card.visual}</SolutionsVisualFrame>
    </article>
  )
}
