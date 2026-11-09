'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { truncate } from '@sim/utils/string'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas-error/canvas-error.module.css'
import {
  captureClientEvent,
  captureClientException,
  createLogger,
} from '@/platform/lib/data/workflows'

const logger = createLogger('ErrorBoundary')

/** Keeps a runaway stack out of the event payload without losing the top frames. */
const MAX_REPORTED_COMPONENT_STACK = 2000

interface ErrorUIProps {
  title?: string
  message?: string
  onReset?: () => void
}

/**
 * The canvas's failure state, centered in the space it replaces, with a way to try again. Without
 * `onReset`, trying again reloads the page.
 */
export function ErrorUI({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again or refresh the page.',
  onReset,
}: ErrorUIProps) {
  return (
    <div className={styles.frame}>
      <EmptyState
        graphic={<Icon name='warning-triangle' />}
        title={title}
        description={message}
        action={
          <Button
            variant='secondary'
            size='compact'
            onClick={onReset ?? (() => window.location.reload())}
          >
            Try again
          </Button>
        }
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
