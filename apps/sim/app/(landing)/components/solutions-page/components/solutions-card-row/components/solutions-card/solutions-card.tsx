import { cn } from '@sim/emcn'
import { SolutionsVisualFrame } from '@/app/(landing)/components/solutions-page/components/solutions-visual-frame'
import {
  SOLUTIONS_FEATURE_TILE_TONE,
  SOLUTIONS_SPACING,
  SOLUTIONS_TEXT_MEASURE,
  SOLUTIONS_VISUAL,
} from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsCardConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * A single solutions card - an `<article>` with an `<h3>` title, a body-color
 * description, and a reserved visual area. The default split variant keeps copy
 * on the page canvas with a framed visual beneath it. The feature-tile variant
 * moves copy and the visual slot into one larger bordered surface for pages that
 * need a unified callout card.
 *
 * The card owns the gap between its text and visual (`cardTextToVisual`) and the
 * title→description stack (`cardTextStack`) - both from named spacing constants.
 * The split variant lands the visual in a fixed-height
 * {@link SolutionsVisualFrame}; the feature-tile variant reserves a larger
 * flexible slot inside its own frame for future UI.
 *
 * A content unit only: it accepts copy and a visual node plus a controlled visual
 * treatment, never arbitrary spacing or class overrides.
 */

interface SolutionsCardProps {
  card: SolutionsCardConfig
  /** Stable id wiring the `<h3>` into the page outline. */
  headingId: string
  /** Visual treatment. Defaults to the original split text + framed visual layout. */
  variant?: 'split' | 'featureTile'
}

export function SolutionsCard({ card, headingId, variant = 'split' }: SolutionsCardProps) {
  const featureTile = variant === 'featureTile'
  const featureTileTone = SOLUTIONS_FEATURE_TILE_TONE[card.featureTileTone ?? 'light']
  const featureTileDescription =
    card.featureTileDescriptionTone === 'soft' && card.featureTileTone === 'dark'
      ? SOLUTIONS_FEATURE_TILE_TONE.dark.descriptionSoft
      : featureTileTone.description
  const textBlock = (
    <div className={cn('flex flex-col', SOLUTIONS_SPACING.cardTextStack)}>
      <h3
        id={headingId}
        className={cn(
          'leading-[1.3]',
          featureTile
            ? cn('font-medium text-[16px]', featureTileTone.title)
            : 'text-[18px] text-[var(--text-primary)]'
        )}
      >
        {card.title}
      </h3>
      <p
        className={cn(
          SOLUTIONS_TEXT_MEASURE.cardDescription,
          'text-pretty leading-[1.5]',
          featureTile
            ? cn('text-[14px]', featureTileDescription)
            : 'text-[15px] text-[var(--text-body)]'
        )}
      >
        {card.description}
      </p>
    </div>
  )

  if (featureTile) {
    return (
      <article
        className={cn(
          'flex h-full flex-col overflow-hidden rounded-lg',
          featureTileTone.surface,
          SOLUTIONS_VISUAL.featureTileMinHeight,
          SOLUTIONS_SPACING.cardFeatureTilePadding
        )}
      >
        {textBlock}

        <div
          aria-hidden='true'
          className='-mr-8 -mb-8 max-lg:-mr-6 max-lg:-mb-6 mt-8 min-h-[240px] w-[calc(100%+2rem)] flex-1 max-lg:min-h-[210px] max-lg:w-[calc(100%+1.5rem)]'
        >
          <div className='h-full w-full'>{card.visual}</div>
        </div>
      </article>
    )
  }

  return (
    <article className={cn('flex h-full flex-col', SOLUTIONS_SPACING.cardTextToVisual)}>
      <div className='flex flex-1 flex-col'>{textBlock}</div>

      <SolutionsVisualFrame size='card'>{card.visual}</SolutionsVisualFrame>
    </article>
  )
}
