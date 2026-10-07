import { cn } from '@sim/emcn'
import { EmptyState } from '@/components/empty-state/empty-state'
import { HAIRLINE } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/hairline'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

/**
 * Skeleton ink — see the `INK` note in `tables-empty-state.tsx` for why not the surface
 * ramp. `line` is the tables selection ring's opaque mix, so a chart stroke reads as the
 * one drawn mark rather than more placeholder.
 */
const INK = {
  strong: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
  soft: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
  area: 'color-mix(in srgb, var(--text-secondary) 7%, transparent)',
  line: 'color-mix(in srgb, var(--text-secondary) 46%, var(--bg))',
} as const

/** The tables grid's corner fade: the trend panel keeps its meaning cropped. */
const CORNER_FADE =
  '[-webkit-mask-image:linear-gradient(to_right,#000_62%,transparent_100%),linear-gradient(to_bottom,#000_56%,transparent_100%)] [mask-image:linear-gradient(to_right,#000_62%,transparent_100%),linear-gradient(to_bottom,#000_56%,transparent_100%)] [-webkit-mask-composite:source-in] [mask-composite:intersect]'

type Point = readonly [number, number]

const SPARKLINE: Point[] = [
  [52, 62],
  [66, 56],
  [80, 59],
  [94, 50],
  [108, 53],
  [122, 44],
  [136, 47],
  [150, 40],
]

const TREND: Point[] = [
  [52, 140],
  [82, 128],
  [112, 133],
  [142, 112],
  [172, 118],
  [202, 98],
  [232, 104],
  [262, 86],
  [292, 92],
  [322, 76],
]

const LEGEND = [
  { y: 33, width: 34, fill: INK.strong },
  { y: 42, width: 44, fill: INK.soft },
  { y: 51, width: 28, fill: INK.soft },
] as const

const DONUT = { cx: 202, cy: 44, r: 16, strokeWidth: 6 } as const

function toPath(points: Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

const CHART_STROKE = {
  stroke: INK.line,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** A stat tile, a donut tile, and a wide trend panel running off two edges. */
function DashboardGraphic() {
  const donutArc = {
    cx: DONUT.cx,
    cy: DONUT.cy,
    r: DONUT.r,
    strokeWidth: DONUT.strokeWidth,
    pathLength: 100,
    transform: `rotate(-90 ${DONUT.cx} ${DONUT.cy})`,
  }
  return (
    <svg
      viewBox='0 0 320 148'
      width={320}
      height={148}
      fill='none'
      aria-hidden='true'
      focusable='false'
      className={cn('block max-w-none shrink-0', CORNER_FADE, MASK_NO_REPEAT)}
    >
      <rect x='40' y='14' width='124' height='60' rx='6' fill='var(--surface-2)' {...HAIRLINE} />
      <rect x='52' y='24' width='30' height='4' rx='2' fill={INK.soft} />
      <rect x='52' y='33' width='48' height='8' rx='4' fill={INK.strong} />
      <path d={toPath(SPARKLINE)} strokeWidth={1.3} {...CHART_STROKE} />

      <rect x='172' y='14' width='124' height='60' rx='6' fill='var(--surface-2)' {...HAIRLINE} />
      <circle
        cx={DONUT.cx}
        cy={DONUT.cy}
        r={DONUT.r}
        stroke={INK.soft}
        strokeWidth={DONUT.strokeWidth}
      />
      <circle {...donutArc} stroke={INK.line} strokeDasharray='38 62' />
      <circle {...donutArc} stroke={INK.strong} strokeDasharray='24 76' strokeDashoffset={-40} />
      {LEGEND.map((line) => (
        <rect
          key={line.y}
          x='230'
          y={line.y}
          width={line.width}
          height='4'
          rx='2'
          fill={line.fill}
        />
      ))}

      <rect x='40' y='82' width='300' height='90' rx='6' fill='var(--surface-2)' {...HAIRLINE} />
      <rect x='52' y='92' width='40' height='4' rx='2' fill={INK.strong} />
      <path d={`${toPath(TREND)} V 172 H 52 Z`} fill={INK.area} />
      <path d={toPath(TREND)} strokeWidth={1.4} {...CHART_STROKE} />
    </svg>
  )
}

/** Empty state for a workspace whose dashboard Sim has not built yet. */
export function DashboardEmptyState() {
  return (
    <EmptyState
      graphic={<DashboardGraphic />}
      title='Dashboard'
      description='Sim will build your dashboard here once your workspace is set up.'
    />
  )
}
