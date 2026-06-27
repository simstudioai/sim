import type { ReactNode } from 'react'
import { cn } from '@/lib/core/utils/cn'

interface SettingsEmptyStateProps {
  children: ReactNode
  /**
   * `fill` centers the message in the available height — an empty list, or a
   * not-entitled / loading gate. `inline` sits in normal flow — a search that
   * matched nothing. Defaults to `fill`.
   */
  variant?: 'fill' | 'inline'
}

/**
 * Canonical muted status message for settings surfaces: empty lists, search
 * "no results", and entitlement/loading gates. Centralizes the text token and
 * spacing so every settings page reads identically.
 */
export function SettingsEmptyState({ children, variant = 'fill' }: SettingsEmptyStateProps) {
  return (
    <div
      className={cn(
        'text-center text-[var(--text-muted)] text-sm',
        variant === 'fill' ? 'flex h-full items-center justify-center' : 'py-4'
      )}
    >
      {children}
    </div>
  )
}
