'use client'

import { type ReactNode, useEffect } from 'react'
import { Button } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { TriangleAlert } from 'lucide-react'

/** Props shape required by Next.js error boundary files (`error.tsx`). */
export interface ErrorBoundaryProps {
  error: Error & { digest?: string }
  reset: () => void
}

export interface ErrorStateProps extends ErrorBoundaryProps {
  title: string
  description: string
  loggerName: string
  /** Optional glyph for the framed mark. Defaults to `TriangleAlert`. */
  icon?: ReactNode
  /** Extra action buttons rendered before the default "Try again". */
  children?: ReactNode
}

interface ErrorShellProps {
  title: string
  description: string
  icon?: ReactNode
  digest?: string
  children: ReactNode
}

/**
 * Centered layout shared by the workspace error boundary and not-found page.
 * Renders a framed glyph, serif headline, supporting paragraph, optional
 * digest pill, and a row of action buttons.
 */
export function ErrorShell({ title, description, icon, digest, children }: ErrorShellProps) {
  return (
    <div className='flex h-full flex-1 items-center justify-center bg-[var(--bg)] px-6 py-12'>
      <div className='flex w-full max-w-[420px] flex-col items-center gap-5 text-center'>
        <div className='size-[52px] shrink-0 rounded-2xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-sm dark:bg-[var(--surface-5)]'>
          <div className='flex size-full items-center justify-center rounded-[11px] border border-[var(--border-1)] bg-[var(--bg)] text-[var(--text-icon)]'>
            {icon ?? <TriangleAlert className='size-[22px]' strokeWidth={1.55} />}
          </div>
        </div>
        <div className='flex flex-col items-center gap-2'>
          <h2 className='text-balance font-[430] font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
            {title}
          </h2>
          <p className='max-w-[340px] text-[14px] text-[var(--text-tertiary)] leading-[1.55]'>
            {description}
          </p>
        </div>
        {digest && (
          <span className='inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-1)] bg-[var(--surface-5)] px-2.5 py-1 font-mono text-[11px]'>
            <span className='text-[var(--text-muted)]'>digest</span>
            <span className='truncate text-[var(--text-body)]'>{digest}</span>
          </span>
        )}
        <div className='flex flex-wrap items-center justify-center gap-2 pt-1'>{children}</div>
      </div>
    </div>
  )
}

/**
 * Workspace error boundary view. Logs the error once per occurrence and renders
 * `ErrorShell` with a primary "Try again" action. Pass extra buttons (e.g. "Go
 * back") via `children` — they render before the "Try again" button.
 */
export function ErrorState({
  error,
  reset,
  title,
  description,
  loggerName,
  icon,
  children,
}: ErrorStateProps) {
  useEffect(() => {
    createLogger(loggerName).error(`${loggerName} error:`, {
      error: error.message,
      digest: error.digest,
    })
  }, [error.message, error.digest, loggerName])

  return (
    <ErrorShell title={title} description={description} icon={icon} digest={error.digest}>
      {children}
      <Button variant='primary' size='md' onClick={reset}>
        Refresh
      </Button>
    </ErrorShell>
  )
}
