'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { FailureNotice } from '@sim/emcn/status'
import { truncate } from '@sim/utils/string'
import styles from '@/app/(product)/_components/workspace/workflows/canvas-error/canvas-error.module.css'
import {
  captureClientEvent,
  captureClientException,
  createLogger,
} from '@/platform/lib/data/workflows'

const logger = createLogger('ErrorBoundary')

/** Keeps a runaway stack out of the event payload without losing the top frames. */
const MAX_REPORTED_COMPONENT_STACK = 2000

/** The canvas's crash state, centered in the space it replaces; trying again reloads the page. */
function ErrorUI() {
  return (
    <div className={styles.frame}>
      <FailureNotice
        title='Something went wrong'
        message='An unexpected error occurred. Retry reloads the page.'
        onRetry={() => window.location.reload()}
      />
    </div>
  )
}

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

/**
 * React Error Boundary Component
 * Catches React rendering errors and displays ErrorUI fallback
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  /**
   * Reports what was caught. This boundary latches for the life of the document
   * and its fallback names nothing, so without this the only trace of a canvas
   * crash is React's own console output on whichever machine happened to hit it
   * — leaving an intermittent failure with no evidence to diagnose from.
   * `error.name` is carried separately from the message because it is what
   * separates the failure classes from each other.
   *
   * Reported twice, to two different consumers. `captureException` is what
   * reaches PostHog Error Tracking: it parses the stack into `$exception_list`,
   * which is what groups these into an issue and links the session replay — a
   * custom event carrying the message as a string property is invisible there.
   * The named event stays because it answers a different question, "how often
   * does the canvas fall over", against a stable name that survives the
   * error tracker's own grouping and resolution.
   */
  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const componentStack = errorInfo.componentStack ?? undefined
    const reportedComponentStack = componentStack
      ? truncate(componentStack, MAX_REPORTED_COMPONENT_STACK)
      : undefined

    logger.error('Workflow canvas crashed', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack,
    })

    captureClientException(error, {
      error_boundary: 'workflow_canvas',
      component_stack: reportedComponentStack,
    })

    captureClientEvent('workflow_canvas_crashed', {
      error_name: error.name,
      error_message: error.message,
      component_stack: reportedComponentStack,
    })
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || <ErrorUI />
    }

    return this.props.children
  }
}
