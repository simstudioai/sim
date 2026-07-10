import { cn } from '@sim/emcn'
import {
  SolutionsCard,
  SolutionsPillCta,
} from '@/app/(landing)/components/solutions-page/components/solutions-card-row/components'
import {
  SOLUTIONS_SPACING,
  SOLUTIONS_TEXT_MEASURE,
} from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsCardRowConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * A card row - the core repeating unit of a solutions page. A header block (an
 * `<h2>` title, a body-color subtitle, and a single pill CTA) sits above a grid
 * of cards. The grid column count is derived from `cards.length` - 3 cards render
 * `grid-cols-3`, 4 render `grid-cols-4` - so the page never specifies layout.
 *
 * Rendered as a labelled `<section>` for a clean, crawlable landmark; each card
 * is an `<article>` with an `<h3>`, keeping the strict H2 → H3 hierarchy. Every
 * gap (header sub-stack, header-to-grid, and inter-card) is owned by named
 * spacing constants. Only the row header stack can opt into centered text; card
 * text remains left aligned.
 */

interface SolutionsCardRowProps {
  row: SolutionsCardRowConfig
  /** Header stack alignment. Defaults to the original left-aligned layout. */
  align?: 'left' | 'center'
  /** Card treatment. Defaults to the original split copy + visual layout. */
  cardVariant?: 'split' | 'featureTile'
  /** Header typography treatment. Defaults to the original larger solutions header. */
  headerVariant?: 'standard' | 'feature'
}

/** Maps a supported card count to its grid column class; anything else falls back to three-up. */
const GRID_COLS: Record<number, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

export function SolutionsCardRow({
  row,
  align = 'left',
  cardVariant = 'split',
  headerVariant = 'standard',
}: SolutionsCardRowProps) {
  const headingId = `solutions-row-${row.id}-heading`
  const gridCols = GRID_COLS[row.cards.length] ?? GRID_COLS[3]
  const centered = align === 'center'
  const featureHeader = headerVariant === 'feature'

  return (
    <section
      id={`solutions-row-${row.id}`}
      aria-labelledby={headingId}
      className={cn('flex flex-col', SOLUTIONS_SPACING.cardRowHeaderToGrid)}
    >
      <div
        className={cn(
          'flex flex-col',
          centered ? 'items-center text-center' : 'items-start text-left',
          featureHeader ? 'gap-3' : SOLUTIONS_SPACING.cardRowHeaderStack
        )}
      >
        <h2
          id={headingId}
          className={cn(
            'text-balance text-[var(--text-primary)] leading-[1.3]',
            featureHeader
              ? 'max-w-[540px] font-medium text-[22px] max-sm:text-[20px]'
              : 'max-w-[760px] text-[32px] max-sm:text-[24px]'
          )}
        >
          {row.title}
        </h2>
        <p
          className={cn(
            featureHeader ? 'w-full min-w-0 max-w-[48ch]' : SOLUTIONS_TEXT_MEASURE.rowSubtitle,
            'text-pretty',
            featureHeader
              ? 'text-[15px] text-[var(--text-muted)] leading-[1.6]'
              : 'text-[20px] text-[var(--text-body)] leading-[1.5]'
          )}
        >
          {row.subtitle}
        </p>
        <div
          className={
            featureHeader
              ? SOLUTIONS_SPACING.cardRowHeaderCtaGapFeature
              : SOLUTIONS_SPACING.cardRowHeaderCtaGap
          }
        >
          <SolutionsPillCta cta={row.cta} />
        </div>
      </div>

      <div
        className={cn(
          'grid',
          gridCols,
          'max-sm:grid-cols-1 max-md:grid-cols-2',
          SOLUTIONS_SPACING.cardGridGap
        )}
      >
        {row.cards.map((card, index) => (
          <SolutionsCard
            key={`${row.id}-${card.title}`}
            card={card}
            headingId={`solutions-row-${row.id}-card-${index}-heading`}
            variant={cardVariant}
          />
        ))}
      </div>
    </section>
  )
}
