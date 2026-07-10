import { ChipTag, cn } from '@sim/emcn'
import Image from 'next/image'
import styles from '@/app/(landing)/enterprise/components/feature-graphics/access-control-graphic.module.css'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'

/** Fixed pixel canvas the vignette is drawn on, centered inside the shell. */
const CANVAS = { WIDTH: 320, HEIGHT: 250 } as const

/** Vertical anchors: team output ports on top, chip input ports below. */
const PORT_Y = { TEAM: 72, CHIP: 208 } as const

const TEAMS = [
  { avatar: '/landing/team-avatar-1.jpg', name: 'Engineering', x: 64, leftClass: 'left-[64px]' },
  { avatar: '/landing/team-avatar-2.jpg', name: 'Support', x: 160, leftClass: 'left-[160px]' },
  { avatar: '/landing/team-avatar-3.jpg', name: 'Ops', x: 256, leftClass: 'left-[256px]' },
] as const

const CHIPS = [
  { label: 'Build', x: 80, leftClass: 'left-[80px]' },
  { label: 'Review', x: 160, leftClass: 'left-[160px]' },
  { label: 'Deploy', x: 240, leftClass: 'left-[240px]' },
] as const

interface Edge {
  /** Team output-port x coordinate. */
  from: number
  /** Chip input-port x coordinate. */
  to: number
  /** Whether this is the emphasized live grant (stronger ink). */
  emphasized?: boolean
}

/**
 * Team → permission grants: Engineering builds, reviews, and deploys
 * (Deploy is the live grant); Support builds and reviews; Ops reviews.
 */
const EDGES: readonly Edge[] = [
  { from: 64, to: 80 },
  { from: 64, to: 160 },
  { from: 160, to: 80 },
  { from: 160, to: 160 },
  { from: 256, to: 160 },
  { from: 64, to: 240, emphasized: true },
] as const

/**
 * Per-index draw classes for the quiet edges — the stagger order is baked
 * into each class's keyframes so all edges share one 6s loop boundary.
 * The emphasized edge uses its own dedicated class instead.
 */
const EDGE_DRAW_CLASSES = [
  styles.edgeDraw0,
  styles.edgeDraw1,
  styles.edgeDraw2,
  styles.edgeDraw3,
  styles.edgeDraw4,
] as const

/** Builds a node-graph edge: vertical tangents easing into both ports. */
function edgePath(edge: Edge): string {
  const { from, to } = edge
  const bend = 62
  return `M ${from} ${PORT_Y.TEAM} C ${from} ${PORT_Y.TEAM + bend} ${to} ${PORT_Y.CHIP - bend} ${to} ${PORT_Y.CHIP}`
}

/**
 * Workspace access told as a vertical role graph, with no window framing:
 * three gradient-circle team avatars across the top flow down through
 * curved node-graph edges — 1px bezier strokes in the deploy tile's faint
 * guide-line grey, each bending toward and landing on the specific
 * permission chip that team holds — so who-can-do-what reads as directed
 * wiring. Scopes narrow across the teams (Engineering builds, reviews, and
 * deploys; Support builds and reviews; Ops reviews). Engineering's Deploy
 * grant is the emphasized element: its curve carries the stronger
 * `--text-secondary` ink into a filled junction node that blooms the row's
 * shared 6s ring pulse; the other chips sit behind quiet hollow
 * port nodes and mono chips (fills stepped up to `--surface-6` so the
 * pills stay legible on the grey ground).
 *
 * Motion (from `access-control-graphic.module.css`, one shared 6s cycle):
 * the edges draw in with a dash-normalized stroke sweep (`pathLength=1`,
 * the deploy tile's pattern), staggered so the grants wire up one after
 * another — quiet edges first, the emphasized Deploy edge last — then
 * hold drawn for the rest of the loop, and the grant node's ring pulse
 * blooms as the emphasized edge lands. Under `prefers-reduced-motion` the
 * graph renders fully drawn and static.
 *
 * The avatar assets are grey radial gradients on a black square, so each
 * sits in a `rounded-full overflow-hidden` clip with a slight scale-up to
 * crop the black canvas past the circle's edge.
 *
 * The feature tile's visual slot bleeds `2rem` right (`1.5rem` under
 * `max-lg`) but not left, so this centered vignette adds matching right
 * padding to land on the tile's visible center instead of the bled slot's
 * center. The fixed-size canvas is `shrink-0`: if it were allowed to
 * shrink at narrow tile widths its absolutely-positioned columns (fixed
 * `left-*` coordinates) would drift right of the box's true midline;
 * instead it keeps its geometry and overflows both edges equally, so the
 * Support → Review axis always sits on the tile's center.
 */
export function AccessControlGraphic() {
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
            {EDGES.map((edge, index) => (
              <path
                key={`${edge.from}-${edge.to}`}
                d={edgePath(edge)}
                pathLength={1}
                className={cn(
                  styles.edgeDraw,
                  edge.emphasized ? styles.edgeDrawEmphasized : EDGE_DRAW_CLASSES[index]
                )}
                stroke={
                  edge.emphasized
                    ? 'var(--text-secondary)'
                    : 'color-mix(in srgb, var(--text-muted) 35%, transparent)'
                }
                strokeWidth='1'
              />
            ))}
          </svg>

          {TEAMS.map((team, index) => (
            <div
              key={team.name}
              className={cn(
                '-translate-x-1/2 absolute top-2 flex w-24 flex-col items-center gap-1.5',
                team.leftClass
              )}
            >
              <span className='relative size-8 overflow-hidden rounded-full shadow-sm'>
                <Image
                  src={team.avatar}
                  alt=''
                  width={32}
                  height={32}
                  className='size-full scale-110 object-cover'
                />
              </span>
              <span
                className={cn(
                  'text-caption',
                  index === 0
                    ? 'font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]'
                )}
              >
                {team.name}
              </span>
            </div>
          ))}

          {CHIPS.map((chip) => {
            const emphasized = EDGES.some((edge) => edge.emphasized && edge.to === chip.x)
            return (
              <div
                key={chip.label}
                className={cn(
                  '-translate-x-1/2 absolute top-[203px] flex flex-col items-center gap-1.5',
                  chip.leftClass
                )}
              >
                <span
                  className={cn(
                    emphasized
                      ? cn('size-2.5 rounded-full bg-[var(--text-primary)]', styles.grantPulse)
                      : 'size-2 rounded-full border border-[var(--text-muted)] bg-[var(--surface-3)]'
                  )}
                />
                <ChipTag
                  variant={emphasized ? 'solid' : 'mono'}
                  className={cn(!emphasized && 'bg-[var(--surface-6)]')}
                >
                  {chip.label}
                </ChipTag>
              </div>
            )
          })}
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
