'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { env, isFalsy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { inter } from '@/app/fonts/inter/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

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

const validateCallbackUrl = (url: string): boolean => {
  try {
    if (url.startsWith('/')) {
      return true
    }

    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
    if (url.startsWith(currentOrigin)) {
      return true
    }

    return false
  } catch (error) {
    logger.error('Error validating callback URL:', { error, url })
    return false
  }
}

export default function SSOForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [buttonClass, setButtonClass] = useState('auth-button-gradient')
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

      // Pre-fill email if provided in URL (e.g., from deployed chat SSO)
      const emailParam = searchParams.get('email')
      if (emailParam) {
        setEmail(emailParam)
      }

      // Check for SSO error from redirect
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

    const checkCustomBrand = () => {
      const computedStyle = getComputedStyle(document.documentElement)
      const brandAccent = computedStyle.getPropertyValue('--brand-accent-hex').trim()

      if (brandAccent && brandAccent !== '#6f3dfa') {
        setButtonClass('auth-button-custom')
      } else {
        setButtonClass('auth-button-gradient')
      }
    }

    checkCustomBrand()

    window.addEventListener('resize', checkCustomBrand)
    const observer = new MutationObserver(checkCustomBrand)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    return () => {
      window.removeEventListener('resize', checkCustomBrand)
      observer.disconnect()
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
      const safeCallbackUrl = validateCallbackUrl(callbackUrl) ? callbackUrl : '/workspace'

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
        <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
          Sign in with SSO
        </h1>
        <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
          Enter your work email to continue
        </p>
      </div>

      <form onSubmit={onSubmit} className={`${inter.className} mt-8 space-y-8`}>
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
                'rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                showEmailValidationError &&
                  emailErrors.length > 0 &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
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

        <Button
          type='submit'
          className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
          disabled={isLoading}
        >
          {isLoading ? 'Redirecting to SSO provider...' : 'Continue with SSO'}
        </Button>
      </form>

      {/* Only show divider and email signin button if email/password is enabled */}
      {!isFalsy(env.NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED) && (
        <>
          <div className={`${inter.className} relative my-6 font-light`}>
            <div className='absolute inset-0 flex items-center'>
              <div className='auth-divider w-full border-t' />
            </div>
            <div className='relative flex justify-center text-sm'>
              <span className='bg-white px-4 font-[340] text-muted-foreground'>Or</span>
            </div>
          </div>

          <div className={`${inter.className} space-y-3`}>
            <Link
              href={`/login${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`}
            >
              <Button
                variant='outline'
                className='w-full rounded-[10px] shadow-sm hover:bg-gray-50'
                type='button'
              >
                Sign in with email
              </Button>
            </Link>
          </div>
        </>
      )}

      {/* Only show signup link if email/password signup is enabled */}
      {!isFalsy(env.NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED) && (
        <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
          <span className='font-normal'>Don't have an account? </span>
          <Link
            href={`/signup${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`}
            className='font-medium text-[var(--brand-accent-hex)] underline-offset-4 transition hover:text-[var(--brand-accent-hover-hex)] hover:underline'
          >
            Sign up
          </Link>
        </div>
      )}

      <div
        className={`${inter.className} auth-text-muted absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[13px] leading-relaxed sm:px-8 md:px-[44px]`}
      >
        By signing in, you agree to our{' '}
        <Link
          href='/terms'
          target='_blank'
          rel='noopener noreferrer'
          className='auth-link underline-offset-4 transition hover:underline'
        >
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link
          href='/privacy'
          target='_blank'
          rel='noopener noreferrer'
          className='auth-link underline-offset-4 transition hover:underline'
        >
          Privacy Policy
        </Link>
      </div>
    </>
  )
}
