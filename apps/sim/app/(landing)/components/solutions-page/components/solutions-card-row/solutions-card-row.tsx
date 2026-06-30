import { cn } from '@/lib/core/utils/cn'
import {
  SolutionsCard,
  SolutionsPillCta,
} from '@/app/(landing)/components/solutions-page/components/solutions-card-row/components'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
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
 * spacing constants; this component exposes no layout prop.
 */

interface SolutionsCardRowProps {
  row: SolutionsCardRowConfig
}

/** Maps a supported card count to its grid column class; anything else falls back to three-up. */
const GRID_COLS: Record<number, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

export function SolutionsCardRow({ row }: SolutionsCardRowProps) {
  const headingId = `solutions-row-${row.id}-heading`
  const gridCols = GRID_COLS[row.cards.length] ?? GRID_COLS[3]

  return (
    <section
      id={`solutions-row-${row.id}`}
      aria-labelledby={headingId}
      className={cn('flex flex-col', SOLUTIONS_SPACING.cardRowHeaderToGrid)}
    >
      <div className={cn('flex flex-col items-start', SOLUTIONS_SPACING.cardRowHeaderStack)}>
        <h2
          id={headingId}
          className='max-w-[760px] text-balance text-[32px] text-[var(--text-primary)] leading-[1.3] max-sm:text-[24px]'
        >
          {row.title}
        </h2>
        <p className='max-w-[640px] text-[20px] text-[var(--text-body)] leading-[1.5]'>
          {row.subtitle}
        </p>
        <SolutionsPillCta cta={row.cta} />
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
            key={`${row.id}-${index}`}
            card={card}
            headingId={`solutions-row-${row.id}-card-${index}-heading`}
          />
        ))}
      </div>
    </section>
  )
}
