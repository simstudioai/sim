import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/settings-section/settings-section.module.css'

interface SettingsSectionProps {
  title: string
  children: ReactNode
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section className={styles.section} aria-label={title}>
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
  description?: string
  children?: ReactNode
  field?: boolean
}

export function SettingsRow({ label, description, children, field }: SettingsRowProps) {
  return (
    <div className={styles.row} data-field={field || undefined}>
      <div className={styles.copy}>
        <span data-type='T043'>{label}</span>
        {description && (
          <span className={styles.detail} data-type='T060'>
            {description}
          </span>
        )}
      </div>
      {children && <div className={styles.control}>{children}</div>}
    </div>
  )
}
