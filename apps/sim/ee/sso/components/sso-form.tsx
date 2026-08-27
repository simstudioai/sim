'use client'

import { useEffect, useState } from 'react'
import { Button, cn, Input, Label } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { client } from '@/lib/auth/auth-client'
import { getEnv, isFalsy } from '@/lib/core/config/env'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AuthSubmitButton } from '@/app/(auth)/components'

const logger = createLogger('SSOForm')
const SSO_SIGN_IN_ERROR = 'Unable to start SSO. Check your email and try again.'

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

interface SSOFormProps {
  /** DISABLE_REGISTRATION. Hides the signup cross-link, which `/signup` blocks. */
  registrationDisabled: boolean
}

export default function SSOForm({ registrationDisabled }: SSOFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)

  const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))

  /**
   * Derived during render rather than seeded into state from an effect: the
   * first painted frame otherwise carries the `/workspace` default, so the
   * "Sign in with email" and "Sign up" links briefly point at the wrong
   * destination on any deep link carrying `?callbackUrl=`.
   */
  const callbackParam = searchParams?.get('callbackUrl') ?? null
  const isCallbackValid = callbackParam !== null && validateCallbackUrl(callbackParam)
  const callbackUrl = callbackParam !== null && isCallbackValid ? callbackParam : '/workspace'

  useEffect(() => {
    if (callbackParam !== null && !isCallbackValid) {
      logger.warn('Invalid callback URL detected and blocked:', { url: callbackParam })
    }
  }, [callbackParam, isCallbackValid])

  useEffect(() => {
    if (searchParams) {
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

      const result = await client.signIn.sso({
        email: emailValue,
        callbackURL: safeCallbackUrl,
        errorCallbackURL: `/sso?error=sso_failed&callbackUrl=${encodeURIComponent(safeCallbackUrl)}`,
      })

      if (!result || result.error) {
        logger.error('SSO sign-in failed', { error: result?.error, email: emailValue })
        setEmailErrors([SSO_SIGN_IN_ERROR])
        setShowEmailValidationError(true)
      }
    } catch (err) {
      logger.error('SSO sign-in failed', { error: err, email: emailValue })
      setEmailErrors([SSO_SIGN_IN_ERROR])
      setShowEmailValidationError(true)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1
          className={
            'text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'
          }
        >
          Sign in with SSO
        </h1>
        <p
          className={
            'text-[color-mix(in_srgb,var(--text-muted)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'
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
              value={email}
              onChange={handleEmailChange}
              className={cn(
                showEmailValidationError &&
                  emailErrors.length > 0 &&
                  'border-[var(--text-error)] focus:border-[var(--text-error)]'
              )}
            />
            {showEmailValidationError && emailErrors.length > 0 && (
              <div className='mt-1 space-y-1 text-[var(--text-error)] text-caption'>
                {emailErrors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        <AuthSubmitButton loading={isLoading} loadingLabel='Redirecting to SSO provider…'>
          Continue with SSO
        </AuthSubmitButton>
      </form>

      {emailEnabled && (
        <>
          <div className='relative my-6 font-light'>
            <div className='absolute inset-0 flex items-center'>
              <div className='w-full border-[var(--border)] border-t' />
            </div>
            <div className='relative flex justify-center text-sm'>
              <span className='bg-[var(--bg)] px-4 font-normal text-[var(--text-muted)]'>Or</span>
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

      {emailEnabled && !registrationDisabled && (
        <div className='pt-6 text-center font-light text-base'>
          <span className='font-normal'>Don't have an account? </span>
          <Link
            href={`/signup${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`}
            className='text-[var(--text-primary)] underline-offset-4 transition hover:underline'
          >
            Sign up
          </Link>
        </div>
      )}

      <div className='absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-normal text-[var(--text-muted)] text-sm leading-relaxed sm:px-8 md:px-[44px]'>
        By signing in, you agree to our{' '}
        <Link
          href='/terms'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[var(--text-muted)] underline-offset-4 transition hover:text-[var(--text-primary)] hover:underline'
        >
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link
          href='/privacy'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[var(--text-muted)] underline-offset-4 transition hover:text-[var(--text-primary)] hover:underline'
        >
          Privacy Policy
        </Link>
      </div>
    </>
  )
}
