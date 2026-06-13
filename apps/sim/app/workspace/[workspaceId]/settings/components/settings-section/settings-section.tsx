import type { ReactNode } from 'react'

interface SettingsSectionProps {
  label: string
  /** Optional node rendered immediately to the right of the label (e.g. an info tooltip). */
  headerAccessory?: ReactNode
  children: ReactNode
}

/**
 * Labeled section primitive that matches the integrations page visual rhythm:
 * a muted small label, a thin divider, then the body content.
 */
export function SettingsSection({ label, headerAccessory, children }: SettingsSectionProps) {
  return (
    <section className='flex flex-col'>
      <div className='flex items-center gap-1.5 pl-0.5'>
        <span className='text-[var(--text-muted)] text-small'>{label}</span>
        {headerAccessory}
      </div>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      {children}
    </section>
  )
}
