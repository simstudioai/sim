'use client'

import { Component, type ReactNode, useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { RefreshCw } from 'lucide-react'
import { ReactFlowProvider } from 'reactflow'
import { Button } from '@/components/emcn'
import { Panel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { usePreventZoom } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

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
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again or refresh the page.',
  onReset,
  fullScreen = false,
}: ErrorUIProps) {
  const preventZoomRef = usePreventZoom()

  if (!fullScreen) {
    return (
      <div className='flex h-full flex-1 items-center justify-center'>
        <div className='flex flex-col items-center gap-[16px] text-center'>
          <div className='flex flex-col gap-[8px]'>
            <h2 className='font-semibold text-[16px] text-[var(--text-primary)]'>{title}</h2>
            <p className='max-w-[300px] text-[13px] text-[var(--text-tertiary)]'>{message}</p>
          </div>
          <Button variant='default' size='sm' onClick={onReset ?? (() => window.location.reload())}>
            <RefreshCw className='mr-[6px] h-[14px] w-[14px]' />
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div ref={preventZoomRef} className='flex h-screen w-full flex-col bg-[var(--surface-1)]'>
      <Sidebar />

      <div className='relative flex flex-1'>
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <div className='pointer-events-none flex flex-col items-center gap-[16px]'>
            <h3 className='font-semibold text-[16px] text-[var(--text-primary)]'>{title}</h3>
            <p className='max-w-sm text-center font-medium text-[14px] text-[var(--text-tertiary)]'>
              {message}
            </p>
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
