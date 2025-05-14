'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

function getErrorMessage(reason: string, details?: string): string {
  switch (reason) {
    case 'missing-token':
      return 'The invitation link is invalid or missing a required parameter.'
    case 'invalid-token':
      return 'The invitation link is invalid or has already been used.'
    case 'expired':
      return 'This invitation has expired. Please ask for a new invitation.'
    case 'already-processed':
      return 'This invitation has already been accepted or declined.'
    case 'email-mismatch':
      return details
        ? details
        : 'This invitation was sent to a different email address than the one you are logged in with.'
    case 'workspace-not-found':
      return 'The workspace associated with this invitation could not be found.'
    case 'server-error':
      return 'An unexpected error occurred while processing your invitation. Please try again later.'
    default:
      return 'An unknown error occurred while processing your invitation.'
  }
}

export default function InviteError() {
  const searchParams = useSearchParams()
  const reason = searchParams?.get('reason') || 'unknown'
  const details = searchParams?.get('details')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    // Only set the error message on the client side
    setErrorMessage(getErrorMessage(reason, details || undefined))
  }, [reason, details])

  // Provide a fallback message for SSR
  const displayMessage = errorMessage || 'Loading error details...'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="mx-auto max-w-md px-6 py-12 bg-card border rounded-lg">
        <div className="flex flex-col items-center text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />

          <h1 className="text-2xl font-bold tracking-tight mb-2">Invitation Error</h1>

          <p className="text-muted-foreground mb-6">{displayMessage}</p>

          <div className="flex flex-col gap-4 w-full">
            <Link href="/w" passHref>
              <Button variant="default" className="w-full">
                Go to Dashboard
              </Button>
            </Link>

            <Link href="/" passHref>
              <Button variant="outline" className="w-full">
                Return to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
