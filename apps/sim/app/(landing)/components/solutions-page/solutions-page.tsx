import { cn } from '@/lib/core/utils/cn'
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
 * Structurally this mirrors `PlatformPage` today; the two are deliberately
 * separate so the solutions layout and its components can diverge from the
 * platform layout without coupling.
 *
 * This component owns the entire `<main>`: the shared `max-w-[1446px]` content
 * column (centered with `mx-auto`, matching the navbar and landing sections), the
 * one horizontal gutter (`SOLUTIONS_SPACING.gutter`), and the inter-section
 * vertical rhythm (`SOLUTIONS_SPACING.sectionRhythm`, the `<main>` flex gap). The
 * hero, the logos row, and every card row carry no gutter and no inter-section
 * margin of their own, so spacing is uniform and unreachable from a consumer
 * page - the config is pure content (strings + `ReactNode` visual slots), with no
 * layout knob anywhere in its tree.
 *
 * The order is fixed: structured data first (before visible content, derived
 * from the same config so it never drifts) → solutions hero (the page's only
 * `<h1>`) → centered logos row → the configured card rows in array order. The
 * heading outline is strict H1 → H2 (per card row) → H3 (per card), never
 * skipped. Server Component only - no client island lives here; the page
 * supplies its own islands through the `visual` slots in the config.
 */

interface SolutionsPageProps {
  /** The complete page content - identity, hero, and ordered card rows. */
  config: SolutionsPageConfig
}

export function SolutionsPage({ config }: SolutionsPageProps) {
  return (
    <>
      <SolutionsStructuredData config={config} />
      <main
        id='main-content'
        className={cn(
          'mx-auto flex w-full max-w-[1446px] flex-col',
          SOLUTIONS_SPACING.sectionRhythm,
          SOLUTIONS_SPACING.gutter
        )}
      >
        <SolutionsHero hero={config.hero} />
        <SolutionsLogosRow />
        {config.rows.map((row) => (
          <SolutionsCardRow key={row.id} row={row} />
        ))}
      </main>
    </>
  )
}
