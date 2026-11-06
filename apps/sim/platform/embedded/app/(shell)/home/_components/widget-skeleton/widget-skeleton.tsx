import styles from '@/platform/embedded/app/(shell)/home/_components/widget-skeleton/widget-skeleton.module.css'

const ROW_COUNT = 5

interface WidgetSkeletonProps {
  label: string
  /** How many rows the list will have, when that is already known. */
  rows?: number
  /** Whether the list's rows lead with a glyph. */
  glyph?: boolean
  /** A page's skeleton announces itself once, rather than per block. */
  silent?: boolean
}

interface SkeletonPlaceholderProps {
  label: string
  silent?: boolean
}

/** Text a live region can announce, since these shapes say nothing. */
function Announcement({ label, silent }: SkeletonPlaceholderProps) {
  return silent ? null : <span data-visually-hidden>{label}</span>
}

/** Holds a widget's list at its final size, so the page does not move when the data arrives. */
export function WidgetSkeleton({
  label,
  rows = ROW_COUNT,
  glyph = true,
  silent,
}: WidgetSkeletonProps) {
  return (
    <div
      className={styles.rows}
      role={silent ? undefined : 'status'}
      aria-label={silent ? undefined : label}
      aria-hidden={silent || undefined}
    >
      <Announcement label={label} silent={silent} />
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
export function SkeletonBlock({ label, silent }: SkeletonPlaceholderProps) {
  return (
    <div
      className={styles.block}
      role={silent ? undefined : 'status'}
      aria-label={silent ? undefined : label}
      aria-hidden={silent || undefined}
    >
      <Announcement label={label} silent={silent} />
    </div>
  )
}

/** A recents lane holding its height until the history read settles. */
export function SkeletonLane({ label, silent }: SkeletonPlaceholderProps) {
  return (
    <div
      className={styles.lane}
      role={silent ? undefined : 'status'}
      aria-label={silent ? undefined : label}
      aria-hidden={silent || undefined}
    >
      <Announcement label={label} silent={silent} />
      <i />
      <i />
      <i />
    </div>
  )
}
