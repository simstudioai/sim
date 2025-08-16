'use client'

import { Component, type ReactNode, useEffect } from 'react'
import { BotIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { createLogger } from '@/lib/logs/console/logger'
import { ControlBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/control-bar'
import { Panel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel'

const logger = createLogger('ErrorBoundary')

// ======== Shared Error UI Component ========
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
    ? 'flex flex-col w-full h-screen bg-muted/40'
    : 'flex flex-col w-full h-full bg-muted/40'

  return (
    <div className={containerClass}>
      {/* Control bar */}
      <ControlBar hasValidationErrors={false} />

      {/* Main content area */}
      <div className='relative flex flex-1'>
        {/* Error message */}
        <div className='flex flex-1 items-center justify-center'>
          <Card className='max-w-md space-y-4 p-6 text-center'>
            <div className='flex justify-center'>
              <BotIcon className='h-16 w-16 text-muted-foreground' />
            </div>
            <h3 className='font-semibold text-lg'>{title}</h3>
            <p className='text-muted-foreground'>{message}</p>
          </Card>
        </div>

        {/* Console panel */}
        <div className='fixed top-0 right-0 z-10'>
          <Panel />
        </div>
      </div>
    </div>
  )
}

// ======== React Error Boundary Component ========
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

// ======== Next.js Error Page Component ========
interface NextErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export function NextError({ error, reset }: NextErrorProps) {
  useEffect(() => {
    // Optionally log the error to an error reporting service
    logger.error('Workflow error:', { error })
  }, [error])

  return <ErrorUI onReset={reset} />
}

// ======== Next.js Global Error Page Component ========
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
