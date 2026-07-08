import { cn } from '@sim/emcn'
import {
  PlatformCardRow,
  PlatformHero,
  PlatformLogosRow,
  PlatformStructuredData,
} from '@/app/(landing)/components/platform-page/components'
import { PLATFORM_SPACING } from '@/app/(landing)/components/platform-page/constants'
import type { PlatformPageConfig } from '@/app/(landing)/components/platform-page/types'

/**
 * The reusable platform-page content stack - the single component six routes
 * (Workflows, Tables, Files, Knowledge Base, Scheduled Tasks, Logs) consume with
 * near-zero ceremony. A route renders the shared shell and drops in one
 * `<PlatformPage config={…} />`.
 *
 * This component owns the entire `<main>`: the shared `max-w-[1460px]` content
 * column (centered with `mx-auto`, matching the navbar and landing sections), the
 * one horizontal gutter (`PLATFORM_SPACING.gutter`), and the inter-section
 * vertical rhythm (`PLATFORM_SPACING.sectionRhythm`, the `<main>` flex gap). The
 * hero, the logos row, and every card row carry no gutter and no inter-section
 * margin of their own, so spacing is uniform and unreachable from a consumer
 * page - the config is pure content (strings + `ReactNode` visual slots), with no
 * layout knob anywhere in its tree.
 *
 * The order is fixed: structured data first (before visible content, derived
 * from the same config so it never drifts) → platform hero (the page's only
 * `<h1>`) → centered logos row → the configured card rows in array order. The
 * heading outline is strict H1 → H2 (per card row) → H3 (per card), never
 * skipped. Server Component only - no client island lives here; the page
 * supplies its own islands through the `visual` slots in the config.
 */

interface PlatformPageProps {
  /** The complete page content - identity, hero, and ordered card rows. */
  config: PlatformPageConfig
}

export function PlatformPage({ config }: PlatformPageProps) {
  return (
    <>
      <PlatformStructuredData config={config} />
      <main
        id='main-content'
        className={cn(
          'mx-auto flex w-full max-w-[1460px] flex-col',
          PLATFORM_SPACING.sectionRhythm,
          PLATFORM_SPACING.gutter
        )}
      >
        <PlatformHero hero={config.hero} />
        <PlatformLogosRow />
        {config.rows.map((row) => (
          <PlatformCardRow key={row.id} row={row} />
        ))}
      </main>
    </>
  )
}
