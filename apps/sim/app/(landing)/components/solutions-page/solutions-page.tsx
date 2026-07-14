import { cn } from '@sim/emcn'
import { Cta } from '@/app/(landing)/components/cta/cta'
import { LANDING_CONTENT_WIDTH } from '@/app/(landing)/components/landing-layout'
import {
  SolutionsCardRow,
  SolutionsHero,
  SolutionsLogosRow,
  SolutionsStructuredData,
} from '@/app/(landing)/components/solutions-page/components'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsPageConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * The reusable solutions-page content stack - the single component every
 * solution route (IT, Engineering, Finance, Compliance, HR) consumes with
 * near-zero ceremony. A route renders the shared shell and drops in one
 * `<SolutionsPage config={…} />`.
 *
 * This component owns the entire `<main>`: an inner content column carries the
 * shared `max-w-[1460px]` width (centered via `LANDING_CONTENT_WIDTH`, matching
 * the navbar and landing sections), the one horizontal gutter
 * (`SOLUTIONS_SPACING.gutter`), and the inter-section vertical rhythm
 * (`SOLUTIONS_SPACING.sectionRhythm`) - the enterprise page's exact structure.
 * The closing {@link Cta} sits directly in the `<main>` because it owns its own
 * width cap and gutter; the `<main>`'s matching flex gap gives it the same
 * rhythm after the last card row as every other section boundary. The hero, the
 * logos row, and every card row carry no gutter and no inter-section margin of
 * their own, so spacing is uniform and unreachable from a consumer page - the
 * config is pure content (strings + `ReactNode` visual slots), with no layout
 * knob anywhere in its tree.
 *
 * The order is fixed: structured data first (before visible content, derived
 * from the same config so it never drifts) → solutions hero (the page's only
 * `<h1>`) → centered logos row → the configured card rows in array order → the
 * shared pre-footer CTA band. The heading outline is strict H1 → H2 (per card
 * row + the CTA) → H3 (per card), never skipped. Server Component only - no
 * client island lives here; the page supplies its own islands through the
 * `visual` slots in the config.
 */

interface SolutionsPageProps {
  /** The complete page content - identity, hero, and ordered card rows. */
  config: SolutionsPageConfig
  /**
   * Card treatment forwarded to every {@link SolutionsCardRow}. `featureTile`
   * renders the enterprise page's framed feature tiles (copy + visual in one
   * toned surface); the default keeps the original split layout.
   */
  cardVariant?: 'split' | 'featureTile'
}

export function SolutionsPage({ config, cardVariant = 'split' }: SolutionsPageProps) {
  return (
    <>
      <SolutionsStructuredData config={config} />
      <main
        id='main-content'
        className={cn('flex w-full flex-col', SOLUTIONS_SPACING.sectionRhythm)}
      >
        <div
          className={cn(
            'flex flex-col',
            LANDING_CONTENT_WIDTH,
            SOLUTIONS_SPACING.sectionRhythm,
            SOLUTIONS_SPACING.gutter
          )}
        >
          <SolutionsHero hero={config.hero} />
          <SolutionsLogosRow />
          {config.rows.map((row) => (
            <SolutionsCardRow
              key={row.id}
              row={row}
              cardVariant={cardVariant}
              headerVariant={cardVariant === 'featureTile' ? 'feature' : 'standard'}
            />
          ))}
        </div>

        <Cta />
      </main>
    </>
  )
}
