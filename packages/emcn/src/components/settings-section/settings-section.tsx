import type { ReactNode } from 'react'
import styles from '#emcn/components/settings-section/settings-section.module.css'

interface SettingsSectionProps {
  title: string
  children: ReactNode
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section className={styles.section} aria-label={title} data-setting-label={title}>
      <h2 data-type='T093'>{title}</h2>
      <SettingsSurface>{children}</SettingsSurface>
    </section>
  )
}

interface SettingsSurfaceProps {
  children: ReactNode
}

export function SettingsSurface({ children }: SettingsSurfaceProps) {
  return (
    <div className={styles.surface} data-material='reading'>
      {children}
    </div>
  )
}

interface SettingsRowProps {
  label: string
  description?: ReactNode
  /** An avatar or glyph aligned with the first line of the label. */
  leading?: ReactNode
  children?: ReactNode
  field?: boolean
}

export function SettingsRow({ label, description, leading, children, field }: SettingsRowProps) {
  const copy = (
    <div className={styles.copy}>
      <span data-type='T043'>{label}</span>
      {description && (
        <span className={styles.detail} data-type='T060'>
          {description}
        </span>
      )}
    </div>
  )
  return (
    <div className={styles.row} data-field={field || undefined} data-setting-label={label}>
      {leading ? (
        <div className={styles.identity}>
          <span className={styles.leading}>{leading}</span>
          {copy}
        </div>
      ) : (
        copy
      )}
      {children && <div className={styles.control}>{children}</div>}
    </div>
  )
}
