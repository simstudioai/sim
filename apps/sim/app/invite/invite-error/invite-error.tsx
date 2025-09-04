'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
    <div className='flex min-h-screen flex-col items-center justify-center'>
      <div className='mx-auto max-w-md rounded-lg border bg-card px-6 py-12'>
        <div className='flex flex-col items-center text-center'>
          <AlertTriangle className='mb-4 h-12 w-12 text-amber-500' />

          <h1 className='mb-2 font-bold text-2xl tracking-tight'>Invitation Error</h1>

          <p className='mb-6 text-muted-foreground'>{displayMessage}</p>

          <div className='flex w-full flex-col gap-4'>
            <Link href='/workspace' passHref>
              <Button variant='default' className='w-full'>
                Go to Dashboard
              </Button>
            </Link>

            <Link href='/' passHref>
              <Button variant='outline' className='w-full'>
                Return to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
