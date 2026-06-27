'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createLogger } from '@sim/logger'
import { cn } from '@/lib/core/utils/cn'
import { useTranslations } from 'next-intl'

const logger = createLogger('FilePreview')

export function PreviewError({ label, error }: { label: string; error: string }) {
  const t = useTranslations('auto')
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-primary)]'>
        {t('failed_to_preview')} {label}
      </p>
      <p className='text-[13px] text-[var(--text-muted)]'>{error}</p>
    </div>
  )
}

interface PreviewErrorBoundaryProps {
  /** Format label shown in the fallback, e.g. "PDF". */
  label: string
  children: ReactNode
}

interface PreviewErrorBoundaryState {
  hasError: boolean
  error?: Error
}

/**
 * Error boundary for preview renderers. Catches render-time crashes (including
 * a preview module whose dynamic import rejected) and degrades to the standard
 * PreviewError fallback instead of unwinding to the route-level error boundary
 * and replacing the whole workspace view.
 *
 * Callers must `key` this boundary by the identity of the rendered content
 * (e.g. file id + data version) — the error state resets only via remount, so
 * keying the child alone would leave a tripped boundary stuck on the fallback.
 */
export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  public state: PreviewErrorBoundaryState = {
    hasError: false,
  }

  public static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Preview crashed', {
      label: this.props.label,
      error: error.message,
      componentStack: errorInfo.componentStack,
    })
  }

  public render() {
    if (this.state.hasError) {
      return (
        <PreviewError
          label={this.props.label}
          error={this.state.error?.message ?? 'An unexpected error occurred'}
        />
      )
    }

    return this.props.children
  }
}

export function resolvePreviewError(
  fetchError: Error | null,
  renderError: string | null
): string | null {
  // A doc whose compiled artifact never appeared (the binary query exhausted its
  // "still generating" polls) — usually a source that failed to compile or a
  // legacy file with no artifact. Give a clear, actionable message instead of a
  // generic fetch error.
  if (fetchError?.name === 'DocNotReadyError') {
    return "Couldn't generate this document preview. Re-run the file generation to rebuild it."
  }
  if (fetchError) return fetchError.message
  return renderError
}

/**
 * Canonical blank loading overlay for previews that render into a
 * `--surface-1` canvas. Absolutely covers the canvas (with `z-10` so it
 * paints above in-flow render targets) until the preview is ready.
 */
export const PREVIEW_LOADING_OVERLAY = (
  <div className='absolute inset-0 z-10 bg-[var(--surface-1)]' />
)

interface PreviewLoadingFrameProps {
  /** Layout/sizing-only classes for the in-flow frame (e.g. `h-full`, `flex-1`). */
  className?: string
  /** Background token matching the loaded sibling's canvas. Defaults to `--bg`. */
  tone?: 'bg' | 'surface'
}

/**
 * Canonical in-flow blank loading frame shown while a preview is fetching or
 * rendering. The `tone` must match the background of the loaded state it is
 * standing in for, so mount completion does not flash a different token.
 */
export function PreviewLoadingFrame({ className, tone = 'bg' }: PreviewLoadingFrameProps) {
  return (
    <div
      className={cn(tone === 'surface' ? 'bg-[var(--surface-1)]' : 'bg-[var(--bg)]', className)}
    />
  )
}
