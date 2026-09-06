import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import {
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
  LANDING_VIEWPORT_FIT,
} from '@/app/(landing)/components/landing-layout'

/**
 * A full-bleed solid-ground band - the page's only structural device for
 * setting a section apart from the default canvas.
 *
 * Both enterprise sites this page is modeled on use solid areas the same
 * disciplined way: one ground carries roughly the whole page, one barely-there
 * light grey marks a single secondary beat, and exactly one near-black band
 * lands near the end. Harvey runs `#FAFAF9` for everything, one `#F2F1F0`
 * band, and one `#0F0E0D` close; Legora runs an off-white ground, one
 * `#E6E6E6` band, and one near-black. Neither tints more than that.
 *
 * So this component exposes four tones, and no tone is ever used twice:
 *
 * - `paper` - `#F8F8F8`, a hair below the page ground. The product-demo
 *   stage's ground, set by Andrew; no greyscale token lands on it, so it is the
 *   one literal in this map.
 * - `static` - `--surface-6` (#e5e5e5), the Static step of the Sim greyscale.
 *   Marks the governance territory as a distinct place in the page.
 * - `carbon` - `--text-secondary` (#525252), the Carbon step. Kept for a solid
 *   dark field under white product UI.
 * - `ink` - `--text-primary` (#1a1a1a), the Off-Black step. Currently unused:
 *   the homepage close was the one near-black band, and it now ends on a pale
 *   drawing dissolved into the canvas instead. Kept for the next close that
 *   wants the inversion.
 *
 * Every tone is a step of the greyscale. There is no accent hue and no prop for
 * one: the restraint IS the brand.
 *
 * The band spans the full viewport width so its ground bleeds past the content
 * cap to the browser edges, while an inner container restores the shared
 * `max-w-[1728px]` cap and gutter - so type stays on the same vertical lines as
 * every ungrounded section above it. The band owns generous vertical padding of
 * its own (grounds need internal air that a transparent section does not), on
 * top of the `<main>` rhythm gap that separates it from its neighbours.
 *
 * `fit='viewport'` instead sizes the band to the screen below the sticky navbar
 * with tighter padding, and stretches the content column to fill it - so a
 * heading can sit top-left while a stage takes the remaining height.
 */

interface SectionBandProps {
  /** Ground tone. `paper` for the product demo, `static` for governance. */
  tone: 'paper' | 'static' | 'carbon' | 'ink'
  /** `content` pads around the content; `viewport` fills the screen below the navbar. */
  fit?: 'content' | 'viewport'
  /** Section landmark id. */
  id: string
  /** Id of the heading this section is labelled by. */
  labelledBy: string
  /** Band content, rendered inside the capped and guttered container. */
  children: ReactNode
}

const TONE = {
  paper: 'bg-[#F8F8F8] dark:bg-[var(--surface-2)]',
  static: 'bg-[var(--surface-6)] dark:bg-[var(--surface-4)]',
  carbon: 'bg-[var(--text-secondary)]',
  ink: 'bg-[var(--text-primary)]',
} as const

export function SectionBand({ tone, fit = 'content', id, labelledBy, children }: SectionBandProps) {
  const viewport = fit === 'viewport'

  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn('w-full', TONE[tone], viewport && cn('flex', LANDING_VIEWPORT_FIT))}
    >
      <div
        className={cn(
          'relative flex flex-col',
          viewport
            ? 'flex-1 py-16 max-sm:py-10 max-lg:py-12'
            : 'py-[120px] max-sm:py-16 max-lg:py-20',
          LANDING_CONTENT_WIDTH,
          LANDING_GUTTER
        )}
      >
        {children}
      </div>
    </section>
  )
}
