'use client'

import { Component, type ReactNode, useEffect } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { Panel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/panel-new'
import { SidebarNew } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar-new'

const logger = createLogger('ErrorBoundary')

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
  title = 'Workflow Error',
  message = 'This workflow encountered an error and is currently unavailable. Please try again later or create a new workflow.',
  onReset,
  fullScreen = false,
}: ErrorUIProps) {
  const containerClass = fullScreen
    ? 'flex flex-col w-full h-screen bg-[var(--surface-1)]'
    : 'flex flex-col w-full h-full bg-[var(--surface-1)]'

  return (
    <div className={containerClass}>
      {/* Sidebar */}
      <SidebarNew />

      {/* Main content area */}
      <div className='relative flex flex-1'>
        {/* Error message */}
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <div className='pointer-events-none flex flex-col items-center gap-[16px]'>
            {/* Title */}
            <h3 className='font-semibold text-[16px] text-[var(--text-primary)]'>{title}</h3>

            {/* Message */}
            <p className='max-w-md text-center font-medium text-[14px] text-[var(--text-tertiary)]'>
              {message}
            </p>
          </div>
        </div>

        {/* Panel */}
        <Panel />
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

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || <ErrorUI />
    }

    return this.props.children
  }
}

/**
 * Next.js Error Page Component
 * Renders when a workflow-specific error occurs
 */
interface NextErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export function NextError({ error, reset }: NextErrorProps) {
  useEffect(() => {
    logger.error('Workflow error:', { error })
  }, [error])

  return <ErrorUI onReset={reset} />
}

/**
 * Next.js Global Error Page Component
 * Renders for application-level errors
 */
export function NextGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error('Global workspace error:', { error })
  }, [error])

  return (
    <html lang='en'>
      <body>
        <ErrorUI
          title='Application Error'
          message='Something went wrong with the application. Please try again later.'
          onReset={reset}
          fullScreen={true}
        />
      </body>
    </html>
  )
}
