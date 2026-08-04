import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

interface SettingsFieldProps {
  label: ReactNode
  /** Wraps long unbroken values (a URL, a key) instead of overflowing. */
  breakAll?: boolean
  children: ReactNode
}

/**
 * A read-only label/value pair inside a settings detail body: a muted caption
 * over the value. Single source for that pairing — before this, the same field
 * was hand-rolled with three different label sizes and three different gaps.
 *
 * Renders the value paragraph itself, so callers never restate its type tokens.
 * Pass a node instead of text only when the value is a control (a chip, a link).
 */
export function SettingsField({ label, breakAll = false, children }: SettingsFieldProps) {
  return (
    <div className='flex flex-col gap-2'>
      <span className='text-[var(--text-muted)] text-caption'>{label}</span>
      {typeof children === 'string' ? (
        <p className={cn('text-[var(--text-body)] text-sm', breakAll && 'break-all')}>{children}</p>
      ) : (
        children
      )}
    </div>
  )
}
