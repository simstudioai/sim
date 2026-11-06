import { cn } from '@sim/emcn'
import { EmptyState } from '@/components/empty-state/empty-state'
import { HAIRLINE } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/hairline'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

/**
 * Skeleton ink — see the `INK` note in `tables-empty-state.tsx` for why not the surface
 * ramp. `mark` is the tables selection ring's opaque mix, so a status glyph reads as
 * drawn rather than as more placeholder.
 */
const INK = {
  title: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
  detail: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
  mark: 'color-mix(in srgb, var(--text-secondary) 46%, var(--bg))',
} as const

/** The logs feed's falloff — a run report is the same repeating structure. */
const REPORT_FADE =
  '[-webkit-mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)] [mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)]'

type TestStatus = 'pass' | 'fail'

interface ReportRow {
  status: TestStatus
  title: number
  detail: number
}

/**
 * The failure sits second, inside the fade's opaque head, so the one row held in a card
 * never dissolves mid-stroke.
 */
const ROWS: readonly ReportRow[] = [
  { status: 'pass', title: 72, detail: 110 },
  { status: 'fail', title: 64, detail: 124 },
  { status: 'pass', title: 80, detail: 96 },
  { status: 'pass', title: 58, detail: 116 },
] as const

const ROW_PITCH = 38
const BADGE_RADIUS = 8
const GLYPH = BADGE_RADIUS * 0.42

const MARK_STROKE = {
  stroke: INK.mark,
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

interface StatusBadgeProps {
  cx: number
  cy: number
  status: TestStatus
}

/** A pass ticks on a hairline ring; a fail crosses on the heavier ring it shares with its card. */
function StatusBadge({ cx, cy, status }: StatusBadgeProps) {
  const glyph =
    status === 'pass'
      ? `M ${cx - GLYPH} ${cy} L ${cx - GLYPH * 0.25} ${cy + GLYPH * 0.75} L ${cx + GLYPH} ${cy - GLYPH * 0.7}`
      : `M ${cx - GLYPH * 0.75} ${cy - GLYPH * 0.75} L ${cx + GLYPH * 0.75} ${cy + GLYPH * 0.75} M ${cx + GLYPH * 0.75} ${cy - GLYPH * 0.75} L ${cx - GLYPH * 0.75} ${cy + GLYPH * 0.75}`
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={BADGE_RADIUS}
        fill='var(--surface-2)'
        stroke={status === 'pass' ? 'var(--border)' : INK.mark}
        strokeWidth={status === 'pass' ? HAIRLINE.strokeWidth : 1.5}
      />
      <path d={glyph} {...MARK_STROKE} />
    </g>
  )
}

/** A test run report: passing rows, the one failure held in a card like the logs feed's latest run. */
function TestsGraphic() {
  return (
    <svg
      viewBox='0 0 286 148'
      width={286}
      height={148}
      fill='none'
      aria-hidden='true'
      focusable='false'
      className={cn('block max-w-none shrink-0', REPORT_FADE, MASK_NO_REPEAT)}
    >
      {ROWS.map((row, index) => {
        const y = 6 + index * ROW_PITCH
        return (
          <g key={y}>
            {row.status === 'fail' ? (
              <rect
                x='0.5'
                y={y - 2}
                width='285'
                height='36'
                rx='8'
                fill='var(--surface-2)'
                {...HAIRLINE}
              />
            ) : null}
            <StatusBadge cx={22} cy={y + 16} status={row.status} />
            <rect x='40' y={y + 8} width={row.title} height='6' rx='3' fill={INK.title} />
            <rect x='40' y={y + 20} width={row.detail} height='4' rx='2' fill={INK.detail} />
            <rect x='236' y={y + 13} width='30' height='5' rx='2.5' fill={INK.detail} />
          </g>
        )
      })}
    </svg>
  )
}

/** Empty state for a workspace with no tests yet. */
export function TestsEmptyState() {
  return (
    <EmptyState
      graphic={<TestsGraphic />}
      title='Tests'
      description='Write tests to check your workflows behave before you deploy.'
    />
  )
}
