import { cn } from '@sim/emcn'
import {
  SolutionsCard,
  SolutionsCardRowHeader,
} from '@/app/(landing)/components/solutions-page/components/solutions-card-row/components'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsCardRowConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * A card row - the core repeating unit of a solutions page. A header block (an
 * `<h2>` title, a body-color subtitle, and a single pill CTA) sits above a grid
 * of cards. The grid column count is derived from `cards.length` - 3 cards render
 * `grid-cols-3`, 4 render `grid-cols-4` - so the page never specifies layout. A
 * row can opt down to a denser wrap via `row.columns` (e.g. 4 cards as a 2×2
 * grid); the grid's own gap keeps the wrapped rows at the standard inter-tile
 * rhythm.
 *
 * In the two-column band (`sm`..`lg`) a 3-card feature-tile row would leave its
 * third card orphaned beside an empty cell, so that card spans both columns and
 * switches to the tile's wide side-by-side treatment (copy left, graphic
 * right) - see {@link SolutionsCard}'s `tabletSpan`.
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

/** Maps a supported column count to its grid class; anything else falls back to three-up. */
const GRID_COLS: Record<number, string> = {
  2: 'grid-cols-2',
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
  const gridCols = GRID_COLS[row.columns ?? row.cards.length] ?? GRID_COLS[3]

  return (
    <section
      id={`solutions-row-${row.id}`}
      aria-labelledby={headingId}
      className={cn('flex flex-col', SOLUTIONS_SPACING.cardRowHeaderToGrid)}
    >
      <SolutionsCardRowHeader
        row={row}
        headingId={headingId}
        align={align}
        variant={headerVariant}
      />

      <div
        className={cn(
          'grid',
          gridCols,
          'max-sm:grid-cols-1 max-lg:grid-cols-2',
          SOLUTIONS_SPACING.cardGridGap
        )}
      >
        {row.cards.map((card, index) => (
          <SolutionsCard
            key={`${row.id}-${card.title}`}
            card={card}
            headingId={`solutions-row-${row.id}-card-${index}-heading`}
            variant={cardVariant}
            tabletSpan={
              cardVariant === 'featureTile' &&
              row.cards.length === 3 &&
              row.columns === undefined &&
              index === 2
            }
          />
        ))}
      </div>
    </section>
  )
}
