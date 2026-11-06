import styles from '@/platform/embedded/app/(shell)/home/_components/widget-skeleton/widget-skeleton.module.css'

const ROW_COUNT = 5

interface WidgetSkeletonProps {
  label: string
  /** How many rows the list will have, when that is already known. */
  rows?: number
  /** Whether the list's rows lead with a glyph. */
  glyph?: boolean
}

/** Holds a widget's list at its final size, so the page does not move when the data arrives. */
export function WidgetSkeleton({ label, rows = ROW_COUNT, glyph = true }: WidgetSkeletonProps) {
  return (
    <div className={styles.rows} role='status' aria-label={label} aria-busy='true'>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className={styles.row}>
          {glyph && <i className={styles.glyph} />}
          <span className={styles.copy}>
            <i className={styles.title} />
            <i className={styles.detail} />
          </span>
        </span>
      ))}
    </div>
  )
}

/** The same fill for a chart or schedule, whose shape has no rows. */
export function SkeletonBlock({ label }: { label: string }) {
  return <div className={styles.block} role='status' aria-label={label} aria-busy='true' />
}

/** A recents lane holding its height until the history read settles. */
export function SkeletonLane({ label }: { label: string }) {
  return (
    <div className={styles.lane} role='status' aria-label={label} aria-busy='true'>
      <i />
      <i />
      <i />
    </div>
  )
}
