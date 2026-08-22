'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'

const logger = createLogger('ExecutionSnapshotBoundary')

interface SnapshotBoundaryProps {
  children: ReactNode
}

interface SnapshotBoundaryState {
  hasError: boolean
}

/**
 * Error boundary for the lazily loaded execution snapshot.
 *
 * `Suspense` handles the pending state of the lazy import but not its
 * rejection — a failed chunk load (deploy skew, offline) would otherwise
 * unwind to the route-level boundary and replace the whole logs page with an
 * error view over an optional modal. Mirrors `PreviewErrorBoundary` in the
 * file viewer: contain, log, degrade. The snapshot is an overlay, so the
 * degraded state renders nothing and a toast explains why it didn't open.
 *
 * Callers must `key` this boundary by the snapshot's identity (execution id)
 * — the error state resets only via remount, so a tripped boundary would
 * otherwise stay stuck for every later log.
 */
export class SnapshotBoundary extends Component<SnapshotBoundaryProps, SnapshotBoundaryState> {
  public state: SnapshotBoundaryState = { hasError: false }

  public static getDerivedStateFromError(): SnapshotBoundaryState {
    return { hasError: true }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Execution snapshot failed to load', {
      error: error.message,
      componentStack: errorInfo.componentStack,
    })
    toast.error('Could not load the workflow snapshot. Refresh and try again.')
  }

  public render() {
    return this.state.hasError ? null : this.props.children
  }
}
