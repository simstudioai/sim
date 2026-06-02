import type { ReactNode } from 'react'

interface SettingsSectionProps {
  label: string
  children: ReactNode
}

/**
 * Labeled section primitive that matches the integrations page visual rhythm:
 * a muted small label, a thin divider, then the body content.
 */
export function SettingsSection({ label, children }: SettingsSectionProps) {
  return (
    <section className='flex flex-col'>
      <span className='pl-0.5 text-[var(--text-muted)] text-small'>{label}</span>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      {children}
    </section>
  )
}
