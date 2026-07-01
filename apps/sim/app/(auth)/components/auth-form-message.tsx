import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

interface AuthFormMessageProps {
  type: 'error' | 'success'
  align?: 'left' | 'center'
  children: ReactNode
}

/**
 * Form-level status copy (not tied to a single field) in the canonical tokens:
 * errors in `--text-error`, success in `--brand-accent`. One place owns the
 * auth message chrome so success/error states never drift to ad-hoc hex or
 * `text-red-*`/`#4CAF50` colors.
 */
export function AuthFormMessage({ type, align = 'left', children }: AuthFormMessageProps) {
  return (
    <div
      className={cn(
        'space-y-1 text-caption',
        align === 'center' && 'text-center',
        type === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--brand-accent)]'
      )}
    >
      {children}
    </div>
  )
}
