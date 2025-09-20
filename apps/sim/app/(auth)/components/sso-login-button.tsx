'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { env, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { inter } from '@/app/fonts/inter'

const logger = createLogger('SSOLoginButton')

interface SSOLoginButtonProps {
  callbackURL?: string
  className?: string
}

export function SSOLoginButton({ callbackURL, className }: SSOLoginButtonProps) {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showEmailInput, setShowEmailInput] = useState(false)

  // Don't render if SSO is not enabled
  if (!isTruthy(env.NEXT_PUBLIC_SSO_ENABLED)) {
    return null
  }

  const handleSSOSignIn = async () => {
    if (!email) {
      setError('Email is required for SSO sign-in')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Better-auth SSO sign-in according to documentation
      // Use email-based domain matching
      await client.signIn.sso({
        email: email,
        callbackURL: callbackURL || '/workspace',
      })
    } catch (err) {
      logger.error('SSO sign-in failed', { error: err, email })

      // Parse the error to show a better message
      let errorMessage = 'SSO sign-in failed'
      if (err instanceof Error) {
        if (err.message.includes('NO_PROVIDER_FOUND')) {
          errorMessage = 'SSO provider not found. Please check your configuration.'
        } else if (err.message.includes('INVALID_EMAIL_DOMAIN')) {
          errorMessage = 'Email domain not configured for SSO. Please contact your administrator.'
        } else {
          errorMessage = err.message
        }
      }

      setError(errorMessage)
      setIsLoading(false)
    }
  }

  if (!showEmailInput) {
    return (
      <Button
        type='button'
        onClick={() => setShowEmailInput(true)}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-[10px] border border-gray-300 bg-white font-medium text-[15px] text-gray-700 transition-colors hover:bg-gray-50',
          className
        )}
      >
        Sign in with SSO
      </Button>
    )
  }

  return (
    <div className={`${inter.className} space-y-3`}>
      <div className='space-y-2'>
        <Label htmlFor='sso-email' className='font-medium text-sm'>
          Work Email
        </Label>
        <Input
          id='sso-email'
          type='email'
          placeholder='Enter your work email'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className='rounded-[10px] shadow-sm'
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSSOSignIn()
            }
          }}
        />
        {error && <p className='text-red-500 text-xs'>{error}</p>}
      </div>

      <div className='flex gap-2'>
        <Button
          type='button'
          onClick={handleSSOSignIn}
          disabled={isLoading || !email}
          className='flex-1 rounded-[10px] bg-blue-600 font-medium text-white hover:bg-blue-700'
        >
          {isLoading ? 'Signing in...' : 'Continue with SSO'}
        </Button>
        <Button
          type='button'
          variant='outline'
          onClick={() => {
            setShowEmailInput(false)
            setEmail('')
            setError(null)
          }}
          className='rounded-[10px]'
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
