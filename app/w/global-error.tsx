'use client'

import { useEffect } from 'react'
import { BotIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'

export default function GlobalError({
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
        <div className="flex items-center justify-center w-full h-screen bg-muted/40">
          <Card className="p-6 max-w-md text-center space-y-4">
            <div className="flex justify-center">
              <BotIcon className="w-16 h-16 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">Application Error</h3>
            <p className="text-muted-foreground">
              Something went wrong with the application. Please try again later.
            </p>
            <button
              onClick={reset}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600"
            >
              Try again
            </button>
          </Card>
        </div>
      </body>
    </html>
  )
}
