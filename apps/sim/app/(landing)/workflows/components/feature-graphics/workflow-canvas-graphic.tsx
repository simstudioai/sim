import { ChipTag, cn } from '@sim/emcn'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/workflows/components/feature-graphics/workflow-canvas-graphic.module.css'

/** Fixed pixel canvas the mini builder is drawn on, centered inside the shell. */
const CANVAS = { WIDTH: 320, HEIGHT: 250 } as const

/**
 * Wires between the three block tiers, with vertical tangents at both
 * ends (the access tile's edge geometry): the trigger drops straight
 * into the agent, then the agent fans out to its two output blocks.
 */
const EDGE_PATHS = [
  'M 160 50 L 160 102',
  'M 160 144 C 160 172 80 168 80 196',
  'M 160 144 C 160 172 240 168 240 196',
] as const

/** Per-index draw classes — the stagger order is baked into each class's keyframes. */
const EDGE_DRAW_CLASSES = [styles.edgeDraw0, styles.edgeDraw1, styles.edgeDraw2] as const

/** Output blocks fanned beneath the agent, mirrored around the center axis. */
const OUTPUT_BLOCKS = [
  { label: 'Slack', leftClass: 'left-[80px]' },
  { label: 'Sheets', leftClass: 'left-[240px]' },
] as const

/**
 * The visual builder told as a mini workflow canvas, with no window
 * framing (the access tile's frameless node-graph composition): three
 * tiers of blocks — a trigger pill across the top, the agent block at
 * center, and two output blocks fanned below — joined by 1px curved SVG
 * edges with vertical tangents landing on small port dots (the access
 * tile's junction vocabulary). Every block is a white card in the audit
 * tile's exact chrome (`--white` fill, 1px `--border-1` hairline,
 * `rounded-lg`, `shadow-sm`) so the canvas reads as the workspace's own
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
 */
export function WorkflowCanvasGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute inset-0 flex items-center justify-center pr-8 max-lg:pr-6'
      >
        <div className='relative h-[250px] w-[320px] shrink-0'>
          <svg
            className='absolute inset-0'
            fill='none'
            viewBox={`0 0 ${CANVAS.WIDTH} ${CANVAS.HEIGHT}`}
            width={CANVAS.WIDTH}
            height={CANVAS.HEIGHT}
          >
            {EDGE_PATHS.map((path, index) => (
              <path
                key={path}
                d={path}
                pathLength={1}
                className={cn(styles.edgeDraw, EDGE_DRAW_CLASSES[index])}
                stroke='color-mix(in srgb, var(--text-muted) 35%, transparent)'
                strokeWidth='1'
              />
            ))}
          </svg>

          <div className='-translate-x-1/2 absolute top-[14px] left-[160px] flex items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-1.5 shadow-sm'>
            <span className='size-2 shrink-0 rounded-full border border-[var(--text-muted)] bg-[var(--surface-3)]' />
            <span className='whitespace-nowrap font-medium text-[var(--text-secondary)] text-caption'>
              New ticket
            </span>
          </div>

          <div className='-translate-x-1/2 absolute top-[102px] left-[160px] flex items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--white)] px-3 py-2.5 shadow-sm'>
            <span
              className={cn(
                'size-2.5 shrink-0 rounded-full bg-[var(--text-primary)]',
                styles.agentPulse
              )}
            />
            <span className='whitespace-nowrap font-medium text-[var(--text-primary)] text-small'>
              Support agent
            </span>
            <ChipTag variant='solid'>Agent</ChipTag>
          </div>

          {OUTPUT_BLOCKS.map((block) => (
            <div
              key={block.label}
              className={cn(
                '-translate-x-1/2 absolute top-[196px] flex items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-1.5 shadow-sm',
                block.leftClass
              )}
            >
              <span className='size-2 shrink-0 rounded-full border border-[var(--text-muted)] bg-[var(--surface-3)]' />
              <span className='whitespace-nowrap font-medium text-[var(--text-secondary)] text-caption'>
                {block.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
