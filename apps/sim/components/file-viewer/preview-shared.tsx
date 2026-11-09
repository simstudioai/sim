'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { createLogger } from '@sim/logger'
import styles from '@/components/file-viewer/preview-shared.module.css'

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

interface UnsupportedPreviewProps {
  name: string
  reason?: string
  /** Offers the file itself when there is nothing to show of it here. */
  onDownload?: () => void
}

/**
 * The end of the line for a file this view cannot draw: a format with no viewer, or a viewer that
 * was expected to work and could not (a HEIC whose server derivative failed, say).
 */
export function UnsupportedPreview({ name, reason, onDownload }: UnsupportedPreviewProps) {
  const ext = fileExtension(name)
  return (
    <div className={styles.center}>
      <EmptyState
        title={`Preview not available${reason ? '' : ext ? ` for .${ext} files` : ' for this file'}`}
        description={reason ?? 'Download the file to open it.'}
        action={
          onDownload && (
            <Button variant='secondary' size='compact' icon='I049' onClick={onDownload}>
              Download
            </Button>
          )
        }
      />
    </div>
  )
}

/** A preview that could not be drawn, and why. */
export function PreviewError({ label, error }: { label: string; error: string }) {
  return (
    <div className={styles.center}>
      <EmptyState title={`Failed to preview ${label}`} description={error} />
    </div>
  )
}

interface PreviewErrorBoundaryProps {
  /** The format named in the fallback, such as "PDF". */
  label: string
  children: ReactNode
}

interface PreviewErrorBoundaryState {
  error: Error | null
}

const logger = createLogger('FilePreview')

/**
 * Keeps a renderer's crash, including a viewer module whose import failed, inside the preview
 * instead of unwinding to the page. Key it by the content it draws: only a remount clears it.
 */
export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  public state: PreviewErrorBoundaryState = { error: null }

  public static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { error }
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('Preview crashed', {
      label: this.props.label,
      error: error.message,
      componentStack: info.componentStack,
    })
  }

  public render() {
    if (this.state.error) {
      return (
        <PreviewError
          label={this.props.label}
          error={this.state.error.message || 'An unexpected error occurred'}
        />
      )
    }
    return this.props.children
  }
}

/** What a failed preview says: a document that never finished generating gets its own advice. */
export function resolvePreviewError(
  fetchError: Error | null,
  renderError: string | null
): string | null {
  if (fetchError?.name === 'DocNotReadyError') {
    return "Couldn't generate this document preview. Re-run the file generation to rebuild it."
  }
  if (fetchError) return fetchError.message
  return renderError
}
