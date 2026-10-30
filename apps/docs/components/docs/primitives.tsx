import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/components/docs/classnames'

export const docsControlClass =
  'relative inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-docs-control text-[var(--docs-text)] transition-colors hover:bg-[var(--docs-hover)] active:bg-[var(--docs-pressed)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40 pointer-coarse:before:absolute pointer-coarse:before:-inset-y-2 pointer-coarse:before:inset-x-0 motion-reduce:transition-none'

export const docsMenuClass =
  'rounded-[10px] border border-[var(--docs-border)] bg-[var(--docs-overlay)] p-1 text-docs-control shadow-[var(--docs-menu-shadow)] backdrop-blur-xl'

export const docsMenuItemClass =
  'flex min-h-[30px] cursor-pointer items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-[var(--docs-hover)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

interface DocsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  iconOnly?: boolean
}

/** Shared control geometry scoped to documentation. */
export function DocsButton({ className, iconOnly, type = 'button', ...props }: DocsButtonProps) {
  return (
    <button
      type={type}
      className={cn(docsControlClass, iconOnly && 'size-7 rounded-full p-0', className)}
      {...props}
    />
  )
}

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
