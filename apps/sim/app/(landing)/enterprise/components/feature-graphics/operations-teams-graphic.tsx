import type { CSSProperties } from 'react'
import { cn } from '@sim/emcn'
import { ThinkingLoader } from '@/components/ui'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/operations-teams-graphic.module.css'

/**
 * Fixed pixel canvas the switchboard is drawn on, centered inside the
 * shell. Kept to 280px wide (chips reaching only x 32–250) so every chip
 * stays inside the tile's visible area even at the narrowest three-up
 * tile width (~274px visible at 1024), and 248px tall — the tallest
 * canvas that clears the slot's shortest inner box (~257px at 1024 after
 * bottom-bleed compensation) so the staggered top pills never clip while
 * the wires keep long vertical runs.
 */
const CANVAS = { WIDTH: 280, HEIGHT: 248 } as const

/**
 * The ThinkingLoader's light-grey material (its dark-surface theme from
 * `thinking-loader.module.css`), asserted inline exactly as the deploy
 * tile's Deploy button does — the always-light landing would otherwise
 * ink the loader dark, invisible on the dark tile ground showing through
 * the outlined router hub.
 */
const ROUTER_LOADER_INK = {
  '--tl-grad-inner': '#a7a7a7',
  '--tl-grad-outer': '#d6d6d6',
  '--tl-glow': 'rgba(255, 255, 255, 0.9)',
} as CSSProperties

interface Port {
  /** Tailwind classes positioning the size-2 port dot, centered on the port's canvas x/y. */
  dotClass: string
  /** Tailwind classes placing the tag's center on the port's canvas x, above/below its dot. */
  chipClass: string
  /** Tool name rendered as an outlined tag beside the port. */
  label: string
  /** CSS-module animation class driving this tag's white connect-fill on its scheduled phases. */
  fillClass: string
}

/**
 * Inbound ops tools across the top, staggered like a constellation rather
 * than a rank: Zendesk rides highest on the center axis (x 140), Gmail
 * sits lowest at the left (x 56), Sheets between at the right (x 224).
 */
const SOURCES: readonly Port[] = [
  {
    dotClass: 'top-[48px] left-[52px]',
    chipClass: 'top-[32px] left-[56px]',
    label: 'Gmail',
    fillClass: styles.fillSrcC,
  },
  {
    dotClass: 'top-[28px] left-[136px]',
    chipClass: 'top-[12px] left-[140px]',
    label: 'Zendesk',
    fillClass: styles.fillSrcA,
  },
  {
    dotClass: 'top-[38px] left-[220px]',
    chipClass: 'top-[22px] left-[224px]',
    label: 'Sheets',
    fillClass: styles.fillSrcB,
  },
] as const

/**
 * Outbound destinations mirrored below, staggered the same way: Slack at
 * the left (x 56), Salesforce hanging lowest on the center axis (x 140),
 * Jira highest at the right (x 224).
 */
const DESTINATIONS: readonly Port[] = [
  {
    dotClass: 'top-[192px] left-[52px]',
    chipClass: 'top-[216px] left-[56px]',
    label: 'Slack',
    fillClass: styles.fillDstA,
  },
  {
    dotClass: 'top-[212px] left-[136px]',
    chipClass: 'top-[236px] left-[140px]',
    label: 'Salesforce',
    fillClass: styles.fillDstC,
  },
  {
    dotClass: 'top-[202px] left-[220px]',
    chipClass: 'top-[226px] left-[224px]',
    label: 'Jira',
    fillClass: styles.fillDstB,
  },
] as const

/**
 * Wires from each source port gathering into the router hub's top pole
 * (140, 93) — all three terminate at the same point so they read as a
 * tied bundle feeding the agent, with vertical tangents at both ends
 * (the access tile's edge geometry) and long vertical runs so each curve
 * travels before it arrives.
 */
const IN_PATHS = {
  gmail: 'M 56 52 C 56 74 140 66 140 93',
  zendesk: 'M 140 32 L 140 93',
  sheets: 'M 224 42 C 224 70 140 64 140 93',
} as const

/**
 * Wires fanning out from the router hub's bottom pole (140, 155) — the
 * shared origin splitting to each destination, echoing the deploy tile's
 * single pipeline branching.
 */
const OUT_PATHS = {
  slack: 'M 140 155 C 140 182 56 174 56 196',
  salesforce: 'M 140 155 L 140 216',
  jira: 'M 140 155 C 140 184 224 178 224 206',
} as const

/** Faint-ink stroke for the resting wires (the deploy tile's guide-line grey, quieter). */
const QUIET_STROKE = 'color-mix(in srgb, var(--text-muted-inverse) 28%, transparent)'

/** Shared 1px outline ink for the tags, port dots, and router hub ring. */
const OUTLINE_INK = 'border-[color:color-mix(in_srgb,var(--text-muted-inverse)_45%,transparent)]'

/** Shared SVG props for a resting wire. */
const WIRE_PROPS = { stroke: QUIET_STROKE, strokeWidth: '1' } as const

/** Shared SVG props for a traveling white request-pulse overlay on a wire. */
const PULSE_PROPS = {
  pathLength: 1,
  stroke: 'var(--text-inverse)',
  strokeWidth: '1.25',
  strokeLinecap: 'round',
} as const

/** An outlined integration tag whose white connect-fill crossfades in on its scheduled phases. */
function PortTag({ port }: { port: Port }) {
  return (
    <span
      className={cn('-translate-x-1/2 -translate-y-1/2 absolute whitespace-nowrap', port.chipClass)}
    >
      <span
        className={cn(
          'relative flex h-5 items-center overflow-hidden rounded-md border bg-transparent px-1.5 font-medium text-[var(--text-muted-inverse)] text-caption',
          OUTLINE_INK
        )}
      >
        {port.label}
        <span
          className={cn(
            'absolute inset-0 flex items-center bg-[var(--white)] px-1.5 text-[var(--text-primary)] opacity-0',
            port.fillClass
          )}
        >
          {port.label}
        </span>
      </span>
    </span>
  )
}

/**
 * Operations automation told as a vertical switchboard — the access tile's
 * top-to-bottom composition (sources above, curved bezier edges flowing
 * down to what they feed) in the dark tiles' ink: three ops tools wired in
 * across the top (Gmail, Zendesk, Sheets), an outlined circular router hub
 * at center — the agent — and three destinations wired out below (Slack,
 * Salesforce, Jira). Both rows stagger their tag heights into a loose
 * constellation, giving each wire its own long arc instead of ranking the
 * tags into flat rows. Every element is drawn in the same outlined
 * language: the six tool tags rest as transparent pills with 1px light
 * hairline borders and light-grey ink, the hub is a transparent circle
 * with the same hairline ring, and the wires are 1px curved SVG paths
 * with vertical tangents (the access tile's edge geometry) gathering into
 * the hub's top pole and fanning from its bottom pole — a tied bundle in,
 * a split out.
 *
 * Inside the hub, the platform's gooey {@link ThinkingLoader} runs its
 * default full morph cycle (no pinned variant, unlike the deploy button's
 * `relay`) wearing the deploy button's exact light-grey ink override, so
 * the page's two dark-tile loaders read as the same material — the agent
 * visibly churning through work between dispatches. The loader stops
 * cycling on its own under `prefers-reduced-motion`.
 *
 * Motion (from `operations-teams-graphic.module.css`, one shared 16s
 * timeline of four 4s route phases — Zendesk→Slack, Sheets→Jira,
 * Gmail→Salesforce, Zendesk→Jira — a precomputed shuffle so the routing
 * feels varied): in each phase the source tag's white filled state
 * crossfades in over its outline (ink flipping dark with it), a white
 * pulse falls down its wire into the router — which blooms the family's
 * ring pulse while the agent classifies — then out the bottom pole to
 * the destination tag, whose fill crossfades in as the route connects.
 * Both ends hold briefly, fade back to outlined, and the next pair
 * begins. Everything is static and outlined under
 * `prefers-reduced-motion`.
 *
 * The feature tile's visual slot bleeds `2rem` right and bottom (`1.5rem`
 * under `max-lg`) but not left or top, so the canvas sits inside a
 * matching right- and bottom-padded box to land on the tile's visible
 * center. The fixed-size canvas is centered with a transform (`left-1/2`
 * + `-translate-x-1/2`, the standards tile's approach) so at narrow tile
 * widths it keeps its wiring geometry and overflows both edges equally
 * instead of drifting.
 */
export function OperationsTeamsGraphic() {
  return (
    <FeatureGraphicShell>
      <div aria-hidden='true' className='absolute inset-0 pr-8 pb-8 max-lg:pr-6 max-lg:pb-6'>
        <div className='relative h-full'>
          <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 h-[248px] w-[280px]'>
            <svg
              className='absolute inset-0'
              fill='none'
              viewBox={`0 0 ${CANVAS.WIDTH} ${CANVAS.HEIGHT}`}
              width={CANVAS.WIDTH}
              height={CANVAS.HEIGHT}
            >
              <path d={IN_PATHS.gmail} {...WIRE_PROPS} />
              <path d={IN_PATHS.zendesk} {...WIRE_PROPS} />
              <path d={IN_PATHS.sheets} {...WIRE_PROPS} />
              <path d={OUT_PATHS.slack} {...WIRE_PROPS} />
              <path d={OUT_PATHS.salesforce} {...WIRE_PROPS} />
              <path d={OUT_PATHS.jira} {...WIRE_PROPS} />

              <path
                d={IN_PATHS.zendesk}
                className={cn(styles.pulse, styles.pulseInA)}
                {...PULSE_PROPS}
              />
              <path
                d={IN_PATHS.sheets}
                className={cn(styles.pulse, styles.pulseInB)}
                {...PULSE_PROPS}
              />
              <path
                d={IN_PATHS.gmail}
                className={cn(styles.pulse, styles.pulseInC)}
                {...PULSE_PROPS}
              />
              <path
                d={OUT_PATHS.slack}
                className={cn(styles.pulse, styles.pulseOutA)}
                {...PULSE_PROPS}
              />
              <path
                d={OUT_PATHS.jira}
                className={cn(styles.pulse, styles.pulseOutB)}
                {...PULSE_PROPS}
              />
              <path
                d={OUT_PATHS.salesforce}
                className={cn(styles.pulse, styles.pulseOutC)}
                {...PULSE_PROPS}
              />
            </svg>

            {SOURCES.map((port) => (
              <span key={port.label}>
                <span
                  className={cn(
                    'absolute size-2 rounded-full border bg-[var(--text-secondary)]',
                    OUTLINE_INK,
                    port.dotClass
                  )}
                />
                <PortTag port={port} />
              </span>
            ))}

            {DESTINATIONS.map((port) => (
              <span key={port.label}>
                <span
                  className={cn(
                    'absolute size-2 rounded-full border bg-[var(--text-secondary)]',
                    OUTLINE_INK,
                    port.dotClass
                  )}
                />
                <PortTag port={port} />
              </span>
            ))}

            <div
              className={cn(
                'absolute top-[93px] left-[109px] flex size-[62px] items-center justify-center rounded-full border',
                OUTLINE_INK,
                styles.routerBloom
              )}
            >
              <ThinkingLoader size={36} style={ROUTER_LOADER_INK} />
            </div>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
