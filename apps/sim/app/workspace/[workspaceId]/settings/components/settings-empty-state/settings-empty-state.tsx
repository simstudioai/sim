import type { ReactNode } from 'react'
import { Chip, cn } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'

interface SettingsEmptyStateProps {
  children: ReactNode
  /**
   * `fill` centers the message in the available height — an empty list, or a
   * not-entitled / loading gate. `inline` sits in normal flow — a search that
   * matched nothing. Defaults to `fill`.
   */
  variant?: 'fill' | 'inline'
  /** Renders the message in the error tone, for a failed load. */
  tone?: 'muted' | 'error'
}

interface SettingsQueryErrorStateProps {
  error: unknown
  fallback: string
  isRetrying: boolean
  onRetry: () => void
  variant?: 'fill' | 'inline'
}

/**
 * Canonical muted status message for settings surfaces: empty lists, search
 * "no results", and entitlement/loading gates. Centralizes the text token and
 * spacing so every settings page reads identically.
 */
export function SettingsEmptyState({
  children,
  variant = 'fill',
  tone = 'muted',
}: SettingsEmptyStateProps) {
  return (
    <div
      className={cn(
        'text-center text-sm',
        tone === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--text-muted)]',
        variant === 'fill' ? 'flex h-full items-center justify-center' : 'py-4'
      )}
    >
      {children}
    </div>
  )
}

/** Canonical recoverable error state for settings queries. */
export function SettingsQueryErrorState({
  error,
  fallback,
  isRetrying,
  onRetry,
  variant,
}: SettingsQueryErrorStateProps) {
  return (
    <SettingsEmptyState variant={variant} tone='error'>
      <div className='flex flex-col items-center gap-2'>
        <span>{getErrorMessage(error, fallback)}</span>
        <Chip variant='border' disabled={isRetrying} onClick={onRetry}>
          {isRetrying ? 'Retrying…' : 'Try again'}
        </Chip>
      </div>
    </SettingsEmptyState>
  )
}
