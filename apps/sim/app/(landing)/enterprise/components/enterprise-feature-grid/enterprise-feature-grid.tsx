import { cn } from '@sim/emcn'
import {
  SolutionsCard,
  SolutionsCardRowHeader,
} from '@/app/(landing)/components/solutions-page/components/solutions-card-row/components'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsCardRowConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * The enterprise feature sections rendered as ONE shared CSS grid so cards can
 * reflow across section boundaries in the two-column band (`sm`..`lg`,
 * 640-1023px). Separate per-section grids (what {@link SolutionsCardRow}
 * renders) leave an orphan cell there: each 3-card section breaks 2 + 1.
 *
 * Layout per breakpoint:
 * - `lg`+ (3 columns): source order - every header is followed by its own 3
 *   cards, matching {@link SolutionsCardRow} exactly.
 * - `sm`..`lg` (2 columns): the `sm:max-lg:order-*` classes regroup the 12
 *   cards into balanced blocks of 4 / 4 / 2 / 2 beneath the four headers, so
 *   no grid cell is ever empty. Cards borrowed from the next section render
 *   under the previous header in this band only.
 * - below `sm` (1 column): source order again - each header stacks above its
 *   own 3 cards.
 *
 * Each section keeps its `<section aria-labelledby>` landmark via
 * `display: contents`, so its header and cards participate directly in the
 * outer grid while the document outline (H2 -> H3) and anchor ids stay
 * identical to the `SolutionsCardRow` markup.
 *
 * Vertical rhythm is reproduced from the flex-column layout it replaces: the
 * grid's own `gap-8` (32px) supplies the inter-card gap, and headers carry
 * margins that top the gap up to the original values - `mb-4` lands the
 * header->cards distance at 48px (`cardRowHeaderToGrid`), and the top margins
 * land the section->section distance at 120/88/64px (`sectionRhythm`).
 */

interface EnterpriseFeatureGridProps {
  /** The four 3-card feature rows, in source order. */
  rows: SolutionsCardRowConfig[]
}

/**
 * Header top margins recreating `LANDING_SECTION_RHYTHM` (120/88/64px) on top
 * of the grid's 32px row gap; `mb-4` recreates `cardRowHeaderToGrid` (48px).
 */
const HEADER_RHYTHM = 'mt-[88px] mb-4 max-lg:mt-14 max-sm:mt-8'
const FIRST_HEADER_RHYTHM = 'mb-4'

/** Two-column-band ordering for the four headers (positions 1, 6, 11, 14). */
const TABLET_HEADER_ORDER = [
  'sm:max-lg:order-1',
  'sm:max-lg:order-6',
  'sm:max-lg:order-11',
  'sm:max-lg:order-[14]',
] as const

/**
 * Two-column-band ordering for the 12 cards (flat index = rowIndex * 3 +
 * cardIndex), interleaved with {@link TABLET_HEADER_ORDER} to produce the
 * 4 / 4 / 2 / 2 grouping.
 */
const TABLET_CARD_ORDER = [
  'sm:max-lg:order-2',
  'sm:max-lg:order-3',
  'sm:max-lg:order-4',
  'sm:max-lg:order-5',
  'sm:max-lg:order-7',
  'sm:max-lg:order-8',
  'sm:max-lg:order-9',
  'sm:max-lg:order-10',
  'sm:max-lg:order-12',
  'sm:max-lg:order-[13]',
  'sm:max-lg:order-[15]',
  'sm:max-lg:order-[16]',
] as const

export function EnterpriseFeatureGrid({ rows }: EnterpriseFeatureGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-3 max-sm:grid-cols-1 max-lg:grid-cols-2',
        SOLUTIONS_SPACING.cardGridGap
      )}
    >
      {rows.map((row, rowIndex) => {
        const headingId = `solutions-row-${row.id}-heading`

        return (
          <section
            key={row.id}
            id={`solutions-row-${row.id}`}
            aria-labelledby={headingId}
            className='contents'
          >
            <div
              className={cn(
                'col-span-full',
                rowIndex === 0 ? FIRST_HEADER_RHYTHM : HEADER_RHYTHM,
                TABLET_HEADER_ORDER[rowIndex]
              )}
            >
              <SolutionsCardRowHeader row={row} headingId={headingId} />
            </div>
            {row.cards.map((card, cardIndex) => (
              <div
                key={`${row.id}-${card.title}`}
                className={cn('min-w-0', TABLET_CARD_ORDER[rowIndex * 3 + cardIndex])}
              >
                <SolutionsCard
                  card={card}
                  headingId={`solutions-row-${row.id}-card-${cardIndex}-heading`}
                />
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
