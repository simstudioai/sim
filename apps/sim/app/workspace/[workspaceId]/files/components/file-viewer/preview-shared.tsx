'use client'

import { Component, type ErrorInfo, Fragment, type ReactNode } from 'react'
import { Chip, cn } from '@sim/emcn'
import { Loader } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'

const logger = createLogger('FilePreview')

interface PreviewErrorAction {
  label: string
  onClick: () => void
}

interface PreviewErrorProps {
  /** Format label shown in the message, e.g. "PDF". */
  label: string
  error: string
  /** Recovery affordance. Omitted for fallbacks with nothing to retry. */
  action?: PreviewErrorAction
}

export function PreviewError({ label, error, action }: PreviewErrorProps) {
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-primary)]'>
        Failed to preview {label}
      </p>
      <p className='text-[13px] text-[var(--text-muted)]'>{error}</p>
      {action ? (
        <Chip className='mt-[4px]' onClick={action.onClick}>
          {action.label}
        </Chip>
      ) : null}
    </div>
  )
}

/**
 * A `next/dynamic` / `React.lazy` chunk fetch that rejected. The module system
 * caches the rejection on the lazy component itself, so re-rendering it throws
 * the same error synchronously — only a fresh page load can refetch the chunk.
 */
function isChunkLoadError(error: Error | undefined): boolean {
  if (!error) return false
  if (error.name === 'ChunkLoadError') return true
  return (
    error.message.includes('Loading chunk') || error.message.includes('dynamically imported module')
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
  /** Bumped by "Try again" so the retried subtree remounts rather than resuming. */
  attempt: number
}

/**
 * Error boundary for preview renderers. Catches render-time crashes (including
 * a preview module whose dynamic import rejected) and degrades to the standard
 * PreviewError fallback instead of unwinding to the route-level error boundary
 * and replacing the whole workspace view.
 *
 * The fallback recovers in place, so a tripped boundary is never stuck:
 * - A render-time crash offers "Try again", which clears the error and remounts
 *   the subtree. If the cause is still there the child throws once more and the
 *   fallback returns — bounded, never a retry loop.
 * - A rejected chunk load is cached by the module system and cannot be retried
 *   by re-rendering, so it offers "Reload page" instead.
 *
 * Keying the boundary by content identity (e.g. file id + data version) is still
 * worthwhile so a *different* file starts from a clean boundary.
 */
export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  public state: PreviewErrorBoundaryState = {
    hasError: false,
    attempt: 0,
  }

  public static getDerivedStateFromError(
    error: Error
  ): Pick<PreviewErrorBoundaryState, 'hasError' | 'error'> {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Preview crashed', {
      label: this.props.label,
      error: error.message,
      componentStack: errorInfo.componentStack,
    })
  }

  private readonly handleRetry = () => {
    this.setState((previous) => ({
      hasError: false,
      error: undefined,
      attempt: previous.attempt + 1,
    }))
  }

  private readonly handleReload = () => {
    window.location.reload()
  }

  public render() {
    const { attempt, error, hasError } = this.state

    if (hasError) {
      return (
        <PreviewError
          label={this.props.label}
          error={error?.message ?? 'An unexpected error occurred'}
          action={
            isChunkLoadError(error)
              ? { label: 'Reload page', onClick: this.handleReload }
              : { label: 'Try again', onClick: this.handleRetry }
          }
        />
      )
    }

    return <Fragment key={attempt}>{this.props.children}</Fragment>
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

/** Canonical content-area loading spinner, matching the rest of the app. */
const PREVIEW_LOADING_SPINNER = (
  <Loader className='size-[20px] text-[var(--text-secondary)]' animate />
)

/**
 * Canonical loading overlay for previews that render into a `--surface-1`
 * canvas. Absolutely covers the canvas (with `z-10` so it paints above
 * in-flow render targets) with a centered spinner until the preview is ready.
 */
export const PREVIEW_LOADING_OVERLAY = (
  <div className='absolute inset-0 z-10 flex items-center justify-center bg-[var(--surface-1)]'>
    {PREVIEW_LOADING_SPINNER}
  </div>
)

interface PreviewLoadingFrameProps {
  /** Layout/sizing-only classes for the in-flow frame (e.g. `h-full`, `flex-1`). */
  className?: string
  /** Background token matching the loaded sibling's canvas. Defaults to `--bg`. */
  tone?: 'bg' | 'surface'
}

/**
 * Canonical in-flow loading frame with a centered spinner, shown while a
 * preview is fetching or rendering. The `tone` must match the background of
 * the loaded state it is standing in for, so mount completion does not flash
 * a different token.
 */
export function PreviewLoadingFrame({ className, tone = 'bg' }: PreviewLoadingFrameProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center',
        tone === 'surface' ? 'bg-[var(--surface-1)]' : 'bg-[var(--bg)]',
        className
      )}
    >
      {PREVIEW_LOADING_SPINNER}
    </div>
  )
}
