import styles from '@/platform/app/(shell)/settings/_components/section-skeleton/section-skeleton.module.css'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'

interface SectionSkeletonProps {
  title: string
  rows?: number
}

/** A section's own heading over rows the height of the ones it is reading, so nothing moves. */
export function SectionSkeleton({ title, rows = 3 }: SectionSkeletonProps) {
  return (
    <SettingsSection title={title}>
      <span role='status' data-visually-hidden>
        Loading {title}
      </span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.row} aria-hidden='true'>
          <span className={styles.label} />
          <span className={styles.control} />
        </div>
      ))}
    </SettingsSection>
  )
}
