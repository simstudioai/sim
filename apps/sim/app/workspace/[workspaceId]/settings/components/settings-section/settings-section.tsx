import type { ReactNode } from 'react'

interface SettingsSectionProps {
  label: string
  /** Stable accessible name when the visible label contains mutable metadata such as a count. */
  ariaLabel?: string
  /** Optional node rendered immediately to the right of the label (e.g. an info tooltip). */
  headerAccessory?: ReactNode
  /** Optional control pinned to the far right of the header row (e.g. a Select All chip). */
  action?: ReactNode
  children: ReactNode
}

/**
 * Labeled section primitive that matches the integrations page visual rhythm:
 * a muted small label, a thin divider, then the body content.
 */
export function SettingsSection({
  label,
  ariaLabel,
  headerAccessory,
  action,
  children,
}: SettingsSectionProps) {
  return (
    <section aria-label={ariaLabel ?? label} className='flex flex-col'>
      <div className='flex items-center gap-1.5 pl-0.5'>
        <span className='text-[var(--text-muted)] text-small'>{label}</span>
        {headerAccessory}
        {action && <div className='ml-auto'>{action}</div>}
      </div>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      {children}
    </section>
  )
}
