'use client'

import { cn } from '@/lib/core/utils/cn'

export function PreviewError({ label, error }: { label: string; error: string }) {
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-primary)]'>
        Failed to preview {label}
      </p>
      <p className='text-[13px] text-[var(--text-muted)]'>{error}</p>
    </div>
  )
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
