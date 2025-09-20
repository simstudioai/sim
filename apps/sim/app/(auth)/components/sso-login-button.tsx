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
  // Visual variant for button styling and placement contexts
  // - 'primary' matches the main auth action button style
  // - 'outline' matches social provider buttons
  variant?: 'primary' | 'outline'
  // Optional class used when variant is primary to match brand/gradient
  primaryClassName?: string
}

export function SSOLoginButton({
  callbackURL,
  className,
  variant = 'outline',
  primaryClassName,
}: SSOLoginButtonProps) {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showEmailInput, setShowEmailInput] = useState(false)

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
      await client.signIn.sso({
        email: email,
        callbackURL: callbackURL || '/workspace',
      })
    } catch (err) {
      logger.error('SSO sign-in failed', { error: err, email })

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

  const primaryBtnClasses = cn(
    primaryClassName || 'auth-button-gradient',
    'flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200'
  )

  const outlineBtnClasses = cn('w-full rounded-[10px] shadow-sm hover:bg-gray-50')

  if (!showEmailInput) {
    return (
      <Button
        type='button'
        onClick={() => setShowEmailInput(true)}
        variant={variant === 'outline' ? 'outline' : undefined}
        className={cn(variant === 'outline' ? outlineBtnClasses : primaryBtnClasses, className)}
      >
        Sign in with SSO
      </Button>
    )
  }

  return (
    <div className={`${inter.className} space-y-3`}>
      <div className='space-y-2'>
        <Label htmlFor='sso-email' className='font-medium text-sm'>
          Email
        </Label>
        <Input
          id='sso-email'
          type='email'
          placeholder='Enter your email'
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
          variant={variant === 'outline' ? 'outline' : undefined}
          className={cn('flex-1', variant === 'outline' ? outlineBtnClasses : primaryBtnClasses)}
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
