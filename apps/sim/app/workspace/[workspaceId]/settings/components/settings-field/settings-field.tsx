import type { ReactNode } from 'react'

interface SettingsFieldProps {
  label: ReactNode
  children: ReactNode
}

/**
 * A read-only label/value pair inside a settings detail body: a muted caption
 * over the value. Single source for that pairing — before this, the same field
 * was hand-rolled with three different label sizes and three different gaps.
 */
export function SettingsField({ label, children }: SettingsFieldProps) {
  return (
    <div className='flex flex-col gap-2'>
      <span className='text-[var(--text-muted)] text-caption'>{label}</span>
      {children}
    </div>
  )
}

/** Value text inside a {@link SettingsField}. */
export const SETTINGS_FIELD_VALUE_CLASSES = 'text-[var(--text-body)] text-sm'
