import { ChipTag, cn } from '@sim/emcn'
import colorMixFallbacks from '@/app/(landing)/components/shared/color-mix-fallbacks/color-mix-fallbacks.module.css'
import {
  FeatureGraphicShell,
  type FeatureGraphicVariant,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/workflows/components/feature-graphics/workflow-canvas-graphic.module.css'

interface WorkflowCanvasGraphicProps {
  variant?: FeatureGraphicVariant
}

interface WorkflowCanvasLayout {
  width: number
  height: number
  edges: readonly [string, string, string]
  trigger: { topClass: string; leftClass: string }
  agent: { topClass: string; leftClass: string }
  outputTopClass: string
  outputs: readonly [{ label: string; leftClass: string }, { label: string; leftClass: string }]
}

/** Feature-tile crop: a compact landscape graph centered in the bleed slot. */
const TILE_LAYOUT: WorkflowCanvasLayout = {
  width: 320,
  height: 250,
  edges: [
    'M 160 50 L 160 102',
    'M 160 144 C 160 172 80 168 80 196',
    'M 160 144 C 160 172 240 168 240 196',
  ],
  trigger: { topClass: 'top-[14px]', leftClass: 'left-[160px]' },
  agent: { topClass: 'top-[102px]', leftClass: 'left-[160px]' },
  outputTopClass: 'top-[196px]',
  outputs: [
    { label: 'Slack', leftClass: 'left-[80px]' },
    { label: 'Sheets', leftClass: 'left-[240px]' },
  ],
}

/**
 * Homepage portrait crop: the same three-tier graph stretched vertically so
 * it fills a tall bloc instead of floating as a small landscape island.
 */
const PORTRAIT_LAYOUT: WorkflowCanvasLayout = {
  width: 280,
  height: 400,
  edges: [
    'M 140 62 L 140 150',
    'M 140 194 C 140 250 64 260 64 310',
    'M 140 194 C 140 250 216 260 216 310',
  ],
  trigger: { topClass: 'top-[28px]', leftClass: 'left-[140px]' },
  agent: { topClass: 'top-[150px]', leftClass: 'left-[140px]' },
  outputTopClass: 'top-[310px]',
  outputs: [
    { label: 'Slack', leftClass: 'left-[64px]' },
    { label: 'Sheets', leftClass: 'left-[216px]' },
  ],
}

/** Per-index draw classes — the stagger order is baked into each class's keyframes. */
const EDGE_DRAW_CLASSES = [styles.edgeDraw0, styles.edgeDraw1, styles.edgeDraw2] as const

/**
 * The visual builder told as a mini workflow canvas, with no window
 * framing (the access tile's frameless node-graph composition): three
 * tiers of blocks — a trigger pill across the top, the agent block at
 * center, and two output blocks fanned below — joined by 1px curved SVG
 * edges with vertical tangents landing on small port dots (the access
 * tile's junction vocabulary). Every block is a white card in the audit
 * tile's exact chrome (`--white` fill, 1px `--border-1` hairline,
 * `rounded-lg`, `shadow-xs`) so the canvas reads as the workspace's own
 * block language; the agent is the tile's strongest element, pairing its
 * name with a solid `Agent` ChipTag.
 *
 * Motion (from `workflow-canvas-graphic.module.css`, one shared 6s
 * cycle): the edges draw in with a dash-normalized stroke sweep
 * (`pathLength=1`, the deploy tile's pattern), staggered top to bottom
 * so the graph wires up the way a builder connects it — trigger into
 * agent, then each output — and the agent's port node blooms the
 * family's shared ring pulse as the fan-out lands. Under
 * `prefers-reduced-motion` the graph renders fully drawn and static.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled
 * slot's center. The fixed-size canvas is `shrink-0` so it keeps its
 * geometry; narrow grid columns are handled by the feature tile itself,
 * which zooms its whole design-space canvas down proportionally (see
 * `SOLUTIONS_VISUAL`), so the outer blocks are never cropped — the
 * access tile's sizing strategy exactly.
 *
 * Homepage portrait blocs use a taller canvas and scale it to the stage
 * so the graph fills the tall crop instead of sitting as a small island.
 */
export function WorkflowCanvasGraphic({ variant = 'tile' }: WorkflowCanvasGraphicProps) {
  const portrait = variant === 'portrait'
  const layout = portrait ? PORTRAIT_LAYOUT : TILE_LAYOUT

  return (
    <FeatureGraphicShell variant={variant}>
      <div
        aria-hidden='true'
        className={cn(
          'absolute inset-0 flex items-center justify-center',
          portrait ? 'p-3 [container-type:size]' : 'pr-8 max-lg:pr-6'
        )}
      >
        <div
          className={cn(
            'relative shrink-0',
            portrait
              ? 'h-[400px] w-[280px] [scale:min(tan(atan2(100cqw,280px)),tan(atan2(100cqh,400px)))]'
              : 'h-[250px] w-[320px]'
          )}
        >
          <svg
            className='absolute inset-0'
            fill='none'
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
            height={layout.height}
          >
            {layout.edges.map((path, index) => (
              <path
                key={path}
                d={path}
                pathLength={1}
                className={cn(
                  styles.edgeDraw,
                  EDGE_DRAW_CLASSES[index],
                  colorMixFallbacks.mutedStroke35
                )}
                strokeWidth='1'
              />
            ))}
          </svg>

          <div
            className={cn(
              '-translate-x-1/2 absolute flex items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-1.5 shadow-xs dark:bg-[var(--surface-4)]',
              layout.trigger.topClass,
              layout.trigger.leftClass
            )}
          >
            <span className='size-2 shrink-0 rounded-full border border-[var(--text-muted)] bg-[var(--surface-3)]' />
            <span className='whitespace-nowrap text-[var(--text-secondary)] text-caption'>
              New ticket
            </span>
          </div>

          <div
            className={cn(
              '-translate-x-1/2 absolute flex items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-xs dark:bg-[var(--surface-4)]',
              layout.agent.topClass,
              layout.agent.leftClass
            )}
          >
            <span
              className={cn(
                'size-2.5 shrink-0 rounded-full bg-[var(--text-primary)]',
                styles.agentPulse
              )}
            />
            <span className='whitespace-nowrap text-[var(--text-primary)] text-small'>
              Support agent
            </span>
            <ChipTag variant='solid'>Agent</ChipTag>
          </div>

          {layout.outputs.map((block) => (
            <div
              key={block.label}
              className={cn(
                '-translate-x-1/2 absolute flex items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-1.5 shadow-xs dark:bg-[var(--surface-4)]',
                layout.outputTopClass,
                block.leftClass
              )}
            >
              <span className='size-2 shrink-0 rounded-full border border-[var(--text-muted)] bg-[var(--surface-3)]' />
              <span className='whitespace-nowrap text-[var(--text-secondary)] text-caption'>
                {block.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
