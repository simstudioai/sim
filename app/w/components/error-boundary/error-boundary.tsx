'use client'

import { Component, ReactNode } from 'react'
import { BotIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex items-center justify-center w-full h-full bg-muted/40">
            <Card className="p-6 max-w-md text-center space-y-4">
              <div className="flex justify-center">
                <BotIcon className="w-16 h-16 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">Workflow Error</h3>
              <p className="text-muted-foreground">
                This workflow encountered an error and is currently unavailable. Please try again
                later or create a new workflow.
              </p>
            </Card>
          </div>
        )
      )
    }

    return this.props.children
  }
}
