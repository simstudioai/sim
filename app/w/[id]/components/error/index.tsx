'use client'

import { Component, ReactNode, useEffect } from 'react'
import { BotIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'

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
    ? 'flex items-center justify-center w-full h-screen bg-muted/40'
    : 'flex items-center justify-center w-full h-full bg-muted/40'

  return (
    <div className={containerClass}>
      <Card className="p-6 max-w-md text-center space-y-4">
        <div className="flex justify-center">
          <BotIcon className="w-16 h-16 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-muted-foreground">{message}</p>
        {onReset && (
          <button
            onClick={onReset}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600"
          >
            Try again
          </button>
        )}
      </Card>
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
    console.error('Workflow error:', error)
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
    console.error('Global workspace error:', error)
  }, [error])

  return (
    <html>
      <body>
        <ErrorUI
          title="Application Error"
          message="Something went wrong with the application. Please try again later."
          onReset={reset}
          fullScreen={true}
        />
      </body>
    </html>
  )
}
