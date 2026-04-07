'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Label } from '@/components/emcn'
import { client } from '@/lib/auth/auth-client'
import { env, isFalsy } from '@/lib/core/config/env'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'

const logger = createLogger('SSOForm')

const validateEmailField = (emailValue: string): string[] => {
  const errors: string[] = []

  if (!emailValue || !emailValue.trim()) {
    errors.push('Email is required.')
    return errors
  }

  const validation = quickValidateEmail(emailValue.trim().toLowerCase())
  if (!validation.isValid) {
    errors.push(validation.reason || 'Please enter a valid email address.')
  }

  return errors
}

export default function SSOForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [callbackUrl, setCallbackUrl] = useState('/workspace')

  useEffect(() => {
    if (searchParams) {
      const callback = searchParams.get('callbackUrl')
      if (callback) {
        if (validateCallbackUrl(callback)) {
          setCallbackUrl(callback)
        } else {
          logger.warn('Invalid callback URL detected and blocked:', { url: callback })
        }
      }

      const emailParam = searchParams.get('email')
      if (emailParam) {
        setEmail(emailParam)
      }

      const error = searchParams.get('error')
      if (error) {
        const errorMessages: Record<string, string> = {
          account_not_found:
            'No account found. Please contact your administrator to set up SSO access.',
          sso_failed: 'SSO authentication failed. Please try again.',
          invalid_provider: 'SSO provider not configured correctly.',
        }
        setEmailErrors([errorMessages[error] || 'SSO authentication failed. Please try again.'])
        setShowEmailValidationError(true)
      }
    }
  }, [searchParams])

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    const errors = validateEmailField(newEmail)
    setEmailErrors(errors)
    setShowEmailValidationError(false)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const emailRaw = formData.get('email') as string
    const emailValue = emailRaw.trim().toLowerCase()

    const emailValidationErrors = validateEmailField(emailValue)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    if (emailValidationErrors.length > 0) {
      setIsLoading(false)
      return
    }

    try {
      const safeCallbackUrl = callbackUrl

      await client.signIn.sso({
        email: emailValue,
        callbackURL: safeCallbackUrl,
        errorCallbackURL: `/sso?error=sso_failed&callbackUrl=${encodeURIComponent(safeCallbackUrl)}`,
      })
    } catch (err) {
      logger.error('SSO sign-in failed', { error: err, email: emailValue })

      let errorMessage = 'SSO sign-in failed. Please try again.'
      if (err instanceof Error) {
        if (err.message.includes('NO_PROVIDER_FOUND')) {
          errorMessage = 'SSO provider not found. Please check your configuration.'
        } else if (err.message.includes('INVALID_EMAIL_DOMAIN')) {
          errorMessage = 'Email domain not configured for SSO. Please contact your administrator.'
        } else if (err.message.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.'
        } else if (err.message.includes('rate limit')) {
          errorMessage = 'Too many requests. Please wait a moment before trying again.'
        } else if (err.message.includes('SSO_DISABLED')) {
          errorMessage = 'SSO authentication is disabled. Please use another sign-in method.'
        } else {
          errorMessage = err.message
        }
      }

      setEmailErrors([errorMessage])
      setShowEmailValidationError(true)
      setIsLoading(false)
    }
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1
          className={
            'text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'
          }
        >
          Sign in with SSO
        </h1>
        <p
          className={
            'font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'
          }
        >
          Enter your work email to continue
        </p>
      </div>

      <form onSubmit={onSubmit} className={'mt-8 space-y-8'}>
        <div className='space-y-6'>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='email'>Work email</Label>
            </div>
            <Input
              id='email'
              name='email'
              placeholder='Enter your work email'
              required
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect='off'
              autoFocus
              value={email}
              onChange={handleEmailChange}
              className={cn(
                showEmailValidationError &&
                  emailErrors.length > 0 &&
                  'border-red-500 focus:border-red-500'
              )}
            />
            {showEmailValidationError && emailErrors.length > 0 && (
              <div className='mt-1 space-y-1 text-red-400 text-xs'>
                {emailErrors.map((error, index) => (
                  <p key={index}>{error}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        <button type='submit' disabled={isLoading} className={AUTH_SUBMIT_BTN}>
          {isLoading ? (
            <span className='flex items-center gap-2'>
              <Loader2 className='h-4 w-4 animate-spin' />
              Redirecting to SSO provider...
            </span>
          ) : (
            'Continue with SSO'
          )}
        </button>
      </form>

      {/* Only show divider and email signin button if email/password is enabled */}
      {!isFalsy(env.NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED) && (
        <>
          <div className='relative my-6 font-light'>
            <div className='absolute inset-0 flex items-center'>
              <div className='w-full border-[var(--landing-bg-elevated)] border-t' />
            </div>
            <div className='relative flex justify-center text-sm'>
              <span className='bg-[var(--landing-bg)] px-4 font-[340] text-[var(--landing-text-muted)]'>
                Or
              </span>
            </div>
          </div>

          <div className='space-y-3'>
            <Link
              href={`/login${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`}
            >
              <Button variant='outline' className='w-full rounded-[10px]' type='button'>
                Sign in with email
              </Button>
            </Link>
          </div>
        </>
      )}

      {/* Only show signup link if email/password signup is enabled */}
      {!isFalsy(env.NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED) && (
        <div className='pt-6 text-center font-light text-base'>
          <span className='font-normal'>Don't have an account? </span>
          <Link
            href={`/signup${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`}
            className='font-medium text-[var(--landing-text)] underline-offset-4 transition hover:text-white hover:underline'
          >
            Sign up
          </Link>
        </div>
      )}

      <div className='absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[var(--landing-text-muted)] text-sm leading-relaxed sm:px-8 md:px-[44px]'>
        By signing in, you agree to our{' '}
        <Link
          href='/terms'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[var(--landing-text-muted)] underline-offset-4 transition hover:text-[var(--landing-text)] hover:underline'
        >
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link
          href='/privacy'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[var(--landing-text-muted)] underline-offset-4 transition hover:text-[var(--landing-text)] hover:underline'
        >
          Privacy Policy
        </Link>
      </div>
    </>
  )
}
