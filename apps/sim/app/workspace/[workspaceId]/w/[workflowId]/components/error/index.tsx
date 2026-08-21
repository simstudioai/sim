'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@sim/emcn'
import { RefreshCw } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import { ReactFlowProvider } from 'reactflow'
import { captureClientEvent } from '@/lib/posthog/client'
import { Panel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import { readCollapsedCookie } from '@/stores/sidebar/store'

const logger = createLogger('ErrorBoundary')

/** Keeps a runaway stack out of the event payload without losing the top frames. */
const MAX_REPORTED_COMPONENT_STACK = 2000

/**
 * Shared Error UI Component
 */
interface ErrorUIProps {
  title?: string
  message?: string
  onReset?: () => void
  fullScreen?: boolean
}

export function ErrorUI({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again or refresh the page.',
  onReset,
  fullScreen = false,
}: ErrorUIProps) {
  const preventZoomRef = usePreventZoom()

  if (!fullScreen) {
    return (
      <div className='flex h-full flex-1 items-center justify-center'>
        <div className='flex flex-col items-center gap-4 text-center'>
          <div className='flex flex-col gap-2'>
            <h2 className='text-[var(--text-primary)] text-md'>{title}</h2>
            <p className='max-w-[300px] text-[var(--text-tertiary)] text-small'>{message}</p>
          </div>
          <Button variant='default' size='sm' onClick={onReset ?? (() => window.location.reload())}>
            <RefreshCw className='mr-1.5 size-[14px]' />
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div ref={preventZoomRef} className='flex h-screen w-full flex-col bg-[var(--surface-1)]'>
      <Sidebar isCollapsed={readCollapsedCookie()} />

      <div className='relative flex flex-1'>
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <div className='pointer-events-none flex flex-col items-center gap-4'>
            <h3 className='text-[var(--text-primary)] text-md'>{title}</h3>
            <p className='max-w-sm text-center text-[var(--text-tertiary)] text-sm'>{message}</p>
          </div>
        </div>

        <ReactFlowProvider>
          <Panel />
        </ReactFlowProvider>
      </div>
    </div>
  )
}

/**
 * React Error Boundary Component
 * Catches React rendering errors and displays ErrorUI fallback
 */
interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

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
   */
  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const componentStack = errorInfo.componentStack ?? undefined

    logger.error('Workflow canvas crashed', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack,
    })

    captureClientEvent('workflow_canvas_crashed', {
      error_name: error.name,
      error_message: error.message,
      component_stack: componentStack
        ? truncate(componentStack, MAX_REPORTED_COMPONENT_STACK)
        : undefined,
    })
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || <ErrorUI />
    }

    return this.props.children
  }
}
