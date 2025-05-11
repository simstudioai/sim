'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function InvitationErrorPage() {
  const searchParams = useSearchParams()
  const reason = searchParams.get('reason') || 'unknown'
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    // Set an appropriate error message based on the reason code
    switch (reason) {
      case 'missing-token':
        setErrorMessage('The invitation link is invalid or missing a required parameter.')
        break
      case 'invalid-token':
        setErrorMessage('The invitation link is invalid or has already been used.')
        break
      case 'expired':
        setErrorMessage('This invitation has expired. Please ask for a new invitation.')
        break
      case 'already-processed':
        setErrorMessage('This invitation has already been accepted or declined.')
        break
      case 'email-mismatch':
        setErrorMessage(
          'This invitation was sent to a different email address than the one you are logged in with.'
        )
        break
      case 'workspace-not-found':
        setErrorMessage('The workspace associated with this invitation could not be found.')
        break
      case 'server-error':
        setErrorMessage(
          'An unexpected error occurred while processing your invitation. Please try again later.'
        )
        break
      default:
        setErrorMessage('An unknown error occurred while processing your invitation.')
        break
    }
  }, [reason])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="mx-auto max-w-md px-6 py-12 bg-card border rounded-lg">
        <div className="flex flex-col items-center text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />

          <h1 className="text-2xl font-bold tracking-tight mb-2">Invitation Error</h1>

          <p className="text-muted-foreground mb-6">{errorMessage}</p>

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
