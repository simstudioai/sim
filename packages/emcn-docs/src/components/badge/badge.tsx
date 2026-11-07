import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@sim/emcn/lib/cn'

const METHOD_COLORS = {
  GET: 'bg-[var(--docs-blue-soft)] text-[var(--docs-blue)]',
  POST: 'bg-[var(--docs-green-soft)] text-[var(--docs-green)]',
  PUT: 'bg-[var(--docs-purple-soft)] text-[var(--docs-purple)]',
  PATCH: 'bg-[var(--docs-orange-soft)] text-[var(--docs-orange)]',
  DELETE: 'bg-[var(--docs-red-soft)] text-[var(--docs-red)]',
} as const

interface MethodBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  method: string
  compact?: boolean
}

export function MethodBadge({ method, compact, className, ...props }: MethodBadgeProps) {
  const label = method.toUpperCase()
  const color =
    METHOD_COLORS[label as keyof typeof METHOD_COLORS] ??
    'bg-[var(--docs-surface)] text-[var(--docs-muted)]'
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center justify-center rounded-md px-2 font-mono text-docs-control',
        compact && 'h-5 min-w-10 px-1.5 text-docs-caption',
        color,
        className
      )}
      {...props}
    >
      {label}
    </span>
  )
}

interface NeutralBadgeProps {
  children: ReactNode
}

export function NeutralBadge({ children }: NeutralBadgeProps) {
  return (
    <span className='inline-flex items-center rounded-md bg-[var(--docs-surface)] px-2 py-0.5 font-mono text-[var(--docs-muted)] text-docs-caption'>
      {children}
    </span>
  )
}
