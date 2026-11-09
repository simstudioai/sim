import { OverflowText } from '@sim/emcn/overflow-text'
import { formatUnit } from '@/app/(product)/_components/workspace/workspace-session/format'
import type { DashboardUnit } from '@/app/(product)/_components/workspace/workspace-session/model'
import styles from '@/app/(product)/workspace/[workspaceId]/dashboards/_components/signed-bars/signed-bars.module.css'

interface SignedBarsProps {
  label: string
  unit: DashboardUnit
  rows: readonly { id: string; label: string; value: number }[]
}

/** Bar ends round by this many CSS pixels. */
const CORNER = 4

/**
 * Horizontal bars around a shared zero line: decreases extend to the left and increases to the
 * right. Each row states its value, so no reading is hidden behind a hover.
 */
export function SignedBars({ label, unit, rows }: SignedBarsProps) {
  const reach = rows.reduce((max, row) => Math.max(max, Math.abs(row.value)), 0) || 1
  return (
    <ul className={styles.rows} aria-label={label}>
      {rows.map((row) => {
        const half = Number.isFinite(row.value) ? (50 * Math.abs(row.value)) / reach : 0
        const value = formatUnit(row.value, unit)
        return (
          <li key={row.id} className={styles.row}>
            <span className={styles.label} data-type='T060'>
              <OverflowText text={row.label}>{row.label}</OverflowText>
            </span>
            <svg className={styles.track} role='img' aria-label={`${row.label}: ${value}`}>
              <line className={styles.zero} x1='50%' x2='50%' y1='0' y2='100%' />
              <rect
                className={styles.bar}
                data-negative={row.value < 0 || undefined}
                x={row.value < 0 ? `${50 - half}%` : '50%'}
                y='25%'
                width={`${half}%`}
                height='50%'
                rx={CORNER}
              />
            </svg>
            <span className={styles.value} data-type='T060'>
              {row.value > 0 ? `+${value}` : value.replace('-', '−')}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
