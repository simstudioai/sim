import { cn } from '@sim/emcn'
import styles from '@/app/(landing)/components/shared/edge-fade/edge-fade.module.css'

/** A side of a scene that can be softened into the ground behind it. */
export type Edge = 'top' | 'bottom' | 'left' | 'right'

const ALL_EDGES = ['top', 'bottom', 'left', 'right'] as const satisfies readonly Edge[]

/**
 * Shared chrome for every strip: it never takes the pointer and it rides above
 * the scene but below any copy overlaid on the same stage (which sits at
 * `z-10`). It carries no filter, mask, or opacity of its own - any of those
 * would make it a backdrop root and leave its layers with nothing to blur.
 */
const STRIP = 'pointer-events-none absolute z-[5]'

/** Where each strip sits against its positioned ancestor. */
const PLACE = {
  top: 'inset-x-0 top-0',
  bottom: 'inset-x-0 bottom-0',
  left: 'inset-y-0 left-0',
  right: 'inset-y-0 right-0',
} as const satisfies Record<Edge, string>

/**
 * The direction a strip's gradients run, as the module reads it: from the
 * inner edge at 0% to the screen edge at 100%.
 */
const DIRECTION = {
  top: styles.edgeTop,
  bottom: styles.edgeBottom,
  left: styles.edgeLeft,
  right: styles.edgeRight,
} as const satisfies Record<Edge, string>

/**
 * Which way the ground wash pours - strongest at the screen edge, gone by the
 * inner one, so the scene dissolves into the page rather than only softening.
 */
const WASH = {
  top: 'bg-gradient-to-b',
  bottom: 'bg-gradient-to-t',
  left: 'bg-gradient-to-r',
  right: 'bg-gradient-to-l',
} as const satisfies Record<Edge, string>

/**
 * The blur ramp, innermost layer first. Each step roughly doubles the last and
 * is masked one step nearer the screen edge; the module holds the windows and
 * explains why the count stops at five.
 */
const RAMP = [styles.layer0, styles.layer1, styles.layer2, styles.layer3, styles.layer4] as const

/** Which dimension a strip's depth sets. */
const AXIS = { top: 'y', bottom: 'y', left: 'x', right: 'x' } as const

/**
 * How far a strip reaches in from its edge.
 *
 * - `preview` - a compact nav preview keeps the fade within a 40px inset.
 * - `stage` - a scene that owns its whole band has room to spare, so the fade
 *   takes the depth it wants at every width.
 * - `bleed` - a scene that reaches past its content column only as far as the
 *   page lets it. Wide screens leave plenty of room, but the narrow tiers
 *   leave exactly the page gutter, so the depth steps down to match it
 *   (`max-lg` → `px-8`, `max-md` → `px-7`) and the fade never lands on the
 *   column itself.
 */
const DEPTH = {
  preview: { x: 'w-10', y: 'h-10' },
  stage: { x: 'w-[72px] lg:w-[144px]', y: 'h-[96px] lg:h-[128px]' },
  bleed: { x: 'w-[144px] max-md:w-7 max-lg:w-8', y: 'h-[128px] max-md:h-7 max-lg:h-8' },
} as const

/**
 * The grounds a scene can dissolve into. `canvas` is the page's own ground;
 * `paper` is the `#F8F8F8` band of the product-demo stage - the one literal
 * here, paired with the same `--surface-2` the stage takes on the dark
 * ground. `surface` matches the `--surface-3` ground of compact nav previews.
 */
const GROUND = {
  surface: 'from-[var(--surface-3)]',
  canvas: 'from-[var(--bg)]',
  paper: 'from-[#F8F8F8] dark:from-[var(--surface-2)]',
} as const

interface EdgeFadeProps {
  /** The ground the strips dissolve into - the surface the scene sits on. */
  ground: keyof typeof GROUND
  /** Which edges to soften. Every edge by default. */
  edges?: readonly Edge[]
  /** How far each strip reaches in from its edge. */
  depth?: keyof typeof DEPTH
}

/**
 * Blurred, fading edges on a scene: one strip per edge, softening and
 * dissolving whatever the scene carries to that edge into the ground behind
 * it, so content ends in a blur instead of a cut.
 *
 * The blur is progressive - all but sharp where the strip meets the scene,
 * climbing to its full strength at the screen edge, with no onset to catch the
 * eye. Five masked `backdrop-filter` layers compound into that ramp; the
 * ground wash then pours over the top of them.
 *
 * The strips are absolutely positioned against the nearest positioned
 * ancestor, so that ancestor decides the area they frame - a stage box for a
 * scene that fills it, or a dedicated overlay box for a scene (a full-bleed
 * rail) that reaches past its own layout column.
 */
export function EdgeFade({ ground, edges = ALL_EDGES, depth = 'stage' }: EdgeFadeProps) {
  return (
    <>
      {edges.map((edge) => (
        <div
          key={edge}
          className={cn(STRIP, DIRECTION[edge], PLACE[edge], DEPTH[depth][AXIS[edge]])}
        >
          {RAMP.map((layer) => (
            <div key={layer} className={cn(styles.layer, layer)} />
          ))}
          <div className={cn(styles.wash, WASH[edge], GROUND[ground], 'to-transparent')} />
        </div>
      ))}
    </>
  )
}
