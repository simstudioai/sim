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
 * Feature tiles scale proportionally: the tile's content (copy and graphic
 * together) is authored on a design-space canvas and the whole bloc zooms
 * down uniformly when its grid column is narrower than the 352px design
 * width, so intermediate breakpoints render a smaller copy of the desktop
 * tile instead of a squished one. See `SOLUTIONS_VISUAL` for the container
 * query + `tan(atan2())` mechanics; at or above the design width the tile
 * renders fluid at scale 1, byte-identical to the pre-scaler layout.
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
  /**
   * Set by the row on the third card of a 3-card feature-tile row. In the
   * two-column band (`sm`..`lg`) the card spans both grid columns instead of
   * sitting orphaned beside an empty cell, and the tile switches to a wide
   * side-by-side treatment: the copy block sits vertically centered in a left
   * column while the visual slot takes the remaining width at a shorter
   * 360px tile height, so the row reads as designed-for-wide rather than a
   * stretched portrait tile. Graphics detect the wide tile themselves via a
   * container query (the tile is ≥500px only when spanned in this band) and
   * relax their column caps to match. No effect at `lg`+ or below `sm`.
   */
  tabletSpan?: boolean
}

export function SolutionsCard({
  card,
  headingId,
  variant = 'split',
  tabletSpan = false,
}: SolutionsCardProps) {
  const featureTile = variant === 'featureTile'
  const featureTileTone = SOLUTIONS_FEATURE_TILE_TONE[card.featureTileTone ?? 'light']
  const featureTileDescription =
    card.featureTileDescriptionTone === 'soft' && card.featureTileTone === 'dark'
      ? SOLUTIONS_FEATURE_TILE_TONE.dark.descriptionSoft
      : featureTileTone.description
  const wide = featureTile && tabletSpan
  const textBlock = (
    <div
      className={cn(
        'flex flex-col',
        SOLUTIONS_SPACING.cardTextStack,
        wide && 'sm:max-lg:w-[38%] sm:max-lg:shrink-0 sm:max-lg:self-center'
      )}
    >
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
      <div
        className={cn(
          'h-full',
          SOLUTIONS_VISUAL.featureTileContainer,
          wide && 'sm:max-lg:col-span-2'
        )}
      >
        <article
          className={cn(
            'relative h-full overflow-hidden rounded-lg',
            featureTileTone.surface,
            SOLUTIONS_VISUAL.featureTileScale,
            SOLUTIONS_VISUAL.featureTileMinHeight,
            wide && 'sm:max-lg:min-h-[360px]'
          )}
        >
          <div
            className={cn(
              'absolute top-0 left-0 flex flex-col',
              SOLUTIONS_VISUAL.featureTileCanvas,
              SOLUTIONS_SPACING.cardFeatureTilePadding,
              wide && 'sm:max-lg:flex-row sm:max-lg:gap-10'
            )}
          >
            {textBlock}

            <div
              aria-hidden='true'
              className={cn(
                '-mr-8 -mb-8 max-lg:-mr-6 max-lg:-mb-6 mt-8 min-h-[240px] w-[calc(100%+2rem)] flex-1 max-lg:w-[calc(100%+1.5rem)]',
                wide && 'sm:max-lg:mt-0 sm:max-lg:w-auto sm:max-lg:min-w-0'
              )}
            >
              <div className='h-full w-full'>{card.visual}</div>
            </div>
          </div>
        </article>
      </div>
    )
  }

  return (
    <article className={cn('flex h-full flex-col', SOLUTIONS_SPACING.cardTextToVisual)}>
      <div className='flex flex-1 flex-col'>{textBlock}</div>

      <SolutionsVisualFrame size='card'>{card.visual}</SolutionsVisualFrame>
    </article>
  )
}
