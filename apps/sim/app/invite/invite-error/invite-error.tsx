'use client'

import { useEffect, useState } from 'react'
import { RotateCcw, ShieldX } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useBrandConfig } from '@/lib/branding/branding'

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
    case 'user-not-found':
      return 'Your user account could not be found. Please try logging out and logging back in.'
    case 'already-member':
      return 'You are already a member of this organization or workspace.'
    case 'invalid-invitation':
      return 'This invitation is invalid or no longer exists.'
    case 'missing-invitation-id':
      return 'The invitation link is missing required information. Please use the original invitation link.'
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
  const brandConfig = useBrandConfig()

  useEffect(() => {
    // Only set the error message on the client side
    setErrorMessage(getErrorMessage(reason, details || undefined))
  }, [reason, details])

  // Provide a fallback message for SSR
  const displayMessage = errorMessage || 'Loading error details...'

  const isExpiredError = reason === 'expired'

  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black'>
      {/* Logo */}
      <div className='mb-8'>
        <Image
          src={brandConfig.logoUrl || '/logo/b&w/medium.png'}
          alt='Sim Logo'
          width={120}
          height={67}
          className='dark:invert'
          priority
        />
      </div>

      <div className='flex w-full max-w-md flex-col items-center text-center'>
        <div className='mb-6 rounded-full bg-red-50 p-3 dark:bg-red-950/20'>
          <ShieldX className='h-8 w-8 text-red-500 dark:text-red-400' />
        </div>

        <h1 className='mb-2 font-semibold text-black text-xl dark:text-white'>Invitation Error</h1>

        <p className='mb-6 text-gray-600 text-sm leading-relaxed dark:text-gray-300'>
          {displayMessage}
        </p>

        <div className='flex w-full flex-col gap-3'>
          {isExpiredError && (
            <Button
              variant='outline'
              className='w-full border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white'
              asChild
            >
              <Link href='/'>
                <RotateCcw className='mr-2 h-4 w-4' />
                Request New Invitation
              </Link>
            </Button>
          )}

          <Button
            className='w-full'
            style={{ backgroundColor: 'var(--brand-primary-hex)', color: 'white' }}
            asChild
          >
            <Link href='/'>Return to Home</Link>
          </Button>
        </div>
      </div>

      <footer className='mt-8 text-center text-gray-500 text-xs'>
        Need help?{' '}
        <a href='mailto:help@sim.ai' className='text-blue-400 hover:text-blue-300'>
          Contact support
        </a>
      </footer>
    </div>
  )
}
