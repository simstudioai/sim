'use client'

import { useEffect } from 'react'
import { BotIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Optionally log the error to an error reporting service
    console.error('Workflow error:', error)
  }, [error])

  return (
    <div className="flex items-center justify-center w-full h-full bg-muted/40">
      <Card className="p-6 max-w-md text-center space-y-4">
        <div className="flex justify-center">
          <BotIcon className="w-16 h-16 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">Workflow Error</h3>
        <p className="text-muted-foreground">
          This workflow encountered an error and is currently unavailable. Please try again later or
          create a new workflow.
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600"
        >
          Try again
        </button>
      </Card>
    </div>
  )
}
