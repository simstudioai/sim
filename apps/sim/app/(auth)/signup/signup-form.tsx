'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { createLogger } from '@sim/logger'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { Input, Label } from '@/components/emcn'
import { client, useSession } from '@/lib/auth/auth-client'
import { getEnv, isFalsy, isTruthy } from '@/lib/core/config/env'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { captureEvent } from '@/lib/posthog/client'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { SSOLoginButton } from '@/app/(auth)/components/sso-login-button'

const logger = createLogger('SignupForm')

const PASSWORD_VALIDATIONS = {
  minLength: { regex: /.{8,}/, message: 'Password must be at least 8 characters long.' },
  uppercase: {
    regex: /(?=.*?[A-Z])/,
    message: 'Password must include at least one uppercase letter.',
  },
  lowercase: {
    regex: /(?=.*?[a-z])/,
    message: 'Password must include at least one lowercase letter.',
  },
  number: { regex: /(?=.*?[0-9])/, message: 'Password must include at least one number.' },
  special: {
    regex: /(?=.*?[#?!@$%^&*-])/,
    message: 'Password must include at least one special character.',
  },
}

const NAME_VALIDATIONS = {
  required: {
    test: (value: string) => Boolean(value && typeof value === 'string'),
    message: 'Name is required.',
  },
  notEmpty: {
    test: (value: string) => value.trim().length > 0,
    message: 'Name cannot be empty.',
  },
  validCharacters: {
    regex: /^[\p{L}\s\-']+$/u,
    message: 'Name can only contain letters, spaces, hyphens, and apostrophes.',
  },
  noConsecutiveSpaces: {
    regex: /^(?!.*\s\s).*$/,
    message: 'Name cannot contain consecutive spaces.',
  },
}

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

function SignupFormContent({
  githubAvailable,
  googleAvailable,
  isProduction,
}: {
  githubAvailable: boolean
  googleAvailable: boolean
  isProduction: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refetch: refetchSession } = useSession()
  const posthog = usePostHog()
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    captureEvent(posthog, 'signup_page_viewed', {})
  }, [posthog])
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '')
  const [emailError, setEmailError] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileInstance>(null)
  const turnstileSiteKey = useMemo(() => getEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY'), [])
  const redirectUrl = useMemo(
    () => searchParams.get('redirect') || searchParams.get('callbackUrl') || '',
    [searchParams]
  )
  const isInviteFlow = useMemo(
    () =>
      searchParams.get('invite_flow') === 'true' ||
      redirectUrl.startsWith('/invite/') ||
      redirectUrl.startsWith('/credential-account/'),
    [searchParams, redirectUrl]
  )

  const [name, setName] = useState('')
  const [nameErrors, setNameErrors] = useState<string[]>([])
  const [showNameValidationError, setShowNameValidationError] = useState(false)

  const validatePassword = (passwordValue: string): string[] => {
    const errors: string[] = []

    if (!PASSWORD_VALIDATIONS.minLength.regex.test(passwordValue)) {
      errors.push(PASSWORD_VALIDATIONS.minLength.message)
    }

    if (!PASSWORD_VALIDATIONS.uppercase.regex.test(passwordValue)) {
      errors.push(PASSWORD_VALIDATIONS.uppercase.message)
    }

    if (!PASSWORD_VALIDATIONS.lowercase.regex.test(passwordValue)) {
      errors.push(PASSWORD_VALIDATIONS.lowercase.message)
    }

    if (!PASSWORD_VALIDATIONS.number.regex.test(passwordValue)) {
      errors.push(PASSWORD_VALIDATIONS.number.message)
    }

    if (!PASSWORD_VALIDATIONS.special.regex.test(passwordValue)) {
      errors.push(PASSWORD_VALIDATIONS.special.message)
    }

    return errors
  }

  const validateName = (nameValue: string): string[] => {
    const errors: string[] = []

    if (!NAME_VALIDATIONS.required.test(nameValue)) {
      errors.push(NAME_VALIDATIONS.required.message)
      return errors
    }

    if (!NAME_VALIDATIONS.notEmpty.test(nameValue)) {
      errors.push(NAME_VALIDATIONS.notEmpty.message)
      return errors
    }

    if (!NAME_VALIDATIONS.validCharacters.regex.test(nameValue.trim())) {
      errors.push(NAME_VALIDATIONS.validCharacters.message)
    }

    if (!NAME_VALIDATIONS.noConsecutiveSpaces.regex.test(nameValue)) {
      errors.push(NAME_VALIDATIONS.noConsecutiveSpaces.message)
    }

    return errors
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)

    const errors = validatePassword(newPassword)
    setPasswordErrors(errors)
    setShowValidationError(false)
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    setName(rawValue)

    const errors = validateName(rawValue)
    setNameErrors(errors)
    setShowNameValidationError(false)
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    const errors = validateEmailField(newEmail)
    setEmailErrors(errors)
    setShowEmailValidationError(false)

    if (emailError) {
      setEmailError('')
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const emailValueRaw = formData.get('email') as string
    const emailValue = emailValueRaw.trim().toLowerCase()
    const passwordValue = formData.get('password') as string
    const nameValue = formData.get('name') as string

    const trimmedName = nameValue.trim()

    const nameValidationErrors = validateName(trimmedName)
    setNameErrors(nameValidationErrors)
    setShowNameValidationError(nameValidationErrors.length > 0)

    const emailValidationErrors = validateEmailField(emailValue)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    const errors = validatePassword(passwordValue)
    setPasswordErrors(errors)

    setShowValidationError(errors.length > 0)

    try {
      if (
        nameValidationErrors.length > 0 ||
        emailValidationErrors.length > 0 ||
        errors.length > 0
      ) {
        setIsLoading(false)
        return
      }

      if (trimmedName.length > 100) {
        setNameErrors(['Name will be truncated to 100 characters. Please shorten your name.'])
        setShowNameValidationError(true)
        setIsLoading(false)
        return
      }

      const sanitizedName = trimmedName

      let token: string | undefined
      const widget = turnstileRef.current
      if (turnstileSiteKey && widget) {
        try {
          widget.reset()
          widget.execute()
          token = await widget.getResponsePromise()
        } catch {
          captureEvent(posthog, 'signup_failed', {
            error_code: 'captcha_client_failure',
          })
          setFormError('Captcha verification failed. Please try again.')
          setIsLoading(false)
          return
        }
      }

      setFormError(null)
      const response = await client.signUp.email(
        {
          email: emailValue,
          password: passwordValue,
          name: sanitizedName,
        },
        {
          fetchOptions: {
            headers: {
              ...(token ? { 'x-captcha-response': token } : {}),
            },
          },
          onError: (ctx) => {
            logger.error('Signup error:', ctx.error)
            const errorMessage: string[] = ['Failed to create account']

            let errorCode = 'unknown'
            if (ctx.error.code?.includes('USER_ALREADY_EXISTS')) {
              errorCode = 'user_already_exists'
              errorMessage.push(
                'An account with this email already exists. Please sign in instead.'
              )
              setEmailError(errorMessage[0])
            } else if (
              ctx.error.code?.includes('BAD_REQUEST') ||
              ctx.error.message?.includes('Email and password sign up is not enabled')
            ) {
              errorCode = 'signup_disabled'
              errorMessage.push('Email signup is currently disabled.')
              setEmailError(errorMessage[0])
            } else if (ctx.error.code?.includes('INVALID_EMAIL')) {
              errorCode = 'invalid_email'
              errorMessage.push('Please enter a valid email address.')
              setEmailError(errorMessage[0])
            } else if (ctx.error.code?.includes('PASSWORD_TOO_SHORT')) {
              errorCode = 'password_too_short'
              errorMessage.push('Password must be at least 8 characters long.')
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else if (ctx.error.code?.includes('PASSWORD_TOO_LONG')) {
              errorCode = 'password_too_long'
              errorMessage.push('Password must be less than 128 characters long.')
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else if (ctx.error.code?.includes('network')) {
              errorCode = 'network_error'
              errorMessage.push('Network error. Please check your connection and try again.')
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else if (ctx.error.code?.includes('rate limit')) {
              errorCode = 'rate_limited'
              errorMessage.push('Too many requests. Please wait a moment before trying again.')
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else {
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            }

            captureEvent(posthog, 'signup_failed', { error_code: errorCode })
          },
        }
      )

      if (!response || response.error) {
        setIsLoading(false)
        return
      }

      try {
        await refetchSession()
        logger.info('Session refreshed after successful signup')
      } catch (sessionError) {
        logger.error('Failed to refresh session after signup:', sessionError)
      }

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('verificationEmail', emailValue)
        if (isInviteFlow && redirectUrl) {
          sessionStorage.setItem('inviteRedirectUrl', redirectUrl)
          sessionStorage.setItem('isInviteFlow', 'true')
        }
      }

      router.push('/verify?fromSignup=true')
    } catch (error) {
      logger.error('Signup error:', error)
      setIsLoading(false)
    }
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
          Create an account
        </h1>
        <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
          Create an account or log in
        </p>
      </div>

      {/* SSO Login Button (primary top-only when it is the only method) */}
      {(() => {
        const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
        const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))
        const hasSocial = githubAvailable || googleAvailable
        const hasOnlySSO = ssoEnabled && !emailEnabled && !hasSocial
        return hasOnlySSO
      })() && (
        <div className='mt-8'>
          <SSOLoginButton callbackURL={redirectUrl || '/workspace'} variant='primary' />
        </div>
      )}

      {/* Email/Password Form - show unless explicitly disabled */}
      {!isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED')) && (
        <form onSubmit={onSubmit} className='mt-8 space-y-10'>
          <div className='space-y-6'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='name'>Full name</Label>
              </div>
              <div className='relative'>
                <Input
                  id='name'
                  name='name'
                  placeholder='Enter your name'
                  type='text'
                  autoCapitalize='words'
                  autoComplete='name'
                  title='Name can only contain letters, spaces, hyphens, and apostrophes'
                  value={name}
                  onChange={handleNameChange}
                  className={cn(
                    showNameValidationError &&
                      nameErrors.length > 0 &&
                      'border-red-500 focus:border-red-500'
                  )}
                />
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-200 ease-out',
                    showNameValidationError && nameErrors.length > 0
                      ? 'grid-rows-[1fr]'
                      : 'grid-rows-[0fr]'
                  )}
                  aria-live={showNameValidationError && nameErrors.length > 0 ? 'polite' : 'off'}
                >
                  <div className='overflow-hidden'>
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {nameErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='email'>Email</Label>
              </div>
              <div className='relative'>
                <Input
                  id='email'
                  name='email'
                  placeholder='Enter your email'
                  autoCapitalize='none'
                  autoComplete='email'
                  autoCorrect='off'
                  value={email}
                  onChange={handleEmailChange}
                  className={cn(
                    (emailError || (showEmailValidationError && emailErrors.length > 0)) &&
                      'border-red-500 focus:border-red-500'
                  )}
                />
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-200 ease-out',
                    (showEmailValidationError && emailErrors.length > 0) ||
                      (emailError && !showEmailValidationError)
                      ? 'grid-rows-[1fr]'
                      : 'grid-rows-[0fr]'
                  )}
                  aria-live={
                    (showEmailValidationError && emailErrors.length > 0) ||
                    (emailError && !showEmailValidationError)
                      ? 'polite'
                      : 'off'
                  }
                >
                  <div className='overflow-hidden'>
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {showEmailValidationError && emailErrors.length > 0 ? (
                        emailErrors.map((error, index) => <p key={index}>{error}</p>)
                      ) : emailError && !showEmailValidationError ? (
                        <p>{emailError}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='password'>Password</Label>
              </div>
              <div className='relative'>
                <div className='relative'>
                  <Input
                    id='password'
                    name='password'
                    type={showPassword ? 'text' : 'password'}
                    autoCapitalize='none'
                    autoComplete='new-password'
                    placeholder='Enter your password'
                    autoCorrect='off'
                    value={password}
                    onChange={handlePasswordChange}
                    className={cn(
                      'pr-10',
                      showValidationError &&
                        passwordErrors.length > 0 &&
                        'border-red-500 focus:border-red-500'
                    )}
                  />
                  <button
                    type='button'
                    onClick={() => setShowPassword(!showPassword)}
                    className='-translate-y-1/2 absolute top-1/2 right-3 text-[var(--landing-text-muted)] transition hover:text-[var(--landing-text)]'
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-200 ease-out',
                    showValidationError && passwordErrors.length > 0
                      ? 'grid-rows-[1fr]'
                      : 'grid-rows-[0fr]'
                  )}
                  aria-live={showValidationError && passwordErrors.length > 0 ? 'polite' : 'off'}
                >
                  <div className='overflow-hidden'>
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {passwordErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {turnstileSiteKey && (
            <Turnstile
              ref={turnstileRef}
              siteKey={turnstileSiteKey}
              options={{ execution: 'execute', appearance: 'execute' }}
            />
          )}

          {formError && (
            <div className='text-red-400 text-xs'>
              <p>{formError}</p>
            </div>
          )}

          <button type='submit' disabled={isLoading} className={cn('!mt-6', AUTH_SUBMIT_BTN)}>
            {isLoading ? (
              <span className='flex items-center gap-2'>
                <Loader2 className='h-4 w-4 animate-spin' />
                Creating account...
              </span>
            ) : (
              'Create account'
            )}
          </button>
        </form>
      )}

      {/* Divider - show when we have multiple auth methods */}
      {(() => {
        const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
        const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))
        const hasSocial = githubAvailable || googleAvailable
        const hasOnlySSO = ssoEnabled && !emailEnabled && !hasSocial
        const showBottomSection = hasSocial || (ssoEnabled && !hasOnlySSO)
        const showDivider = (emailEnabled || hasOnlySSO) && showBottomSection
        return showDivider
      })() && (
        <div className='relative my-6 font-light'>
          <div className='absolute inset-0 flex items-center'>
            <div className='w-full border-[var(--landing-bg-elevated)] border-t' />
          </div>
          <div className='relative flex justify-center text-sm'>
            <span className='bg-[var(--landing-bg)] px-4 font-[340] text-[var(--landing-text-muted)]'>
              Or continue with
            </span>
          </div>
        </div>
      )}

      {(() => {
        const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
        const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))
        const hasSocial = githubAvailable || googleAvailable
        const hasOnlySSO = ssoEnabled && !emailEnabled && !hasSocial
        const showBottomSection = hasSocial || (ssoEnabled && !hasOnlySSO)
        return showBottomSection
      })() && (
        <div
          className={cn(
            isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED')) ? 'mt-8' : undefined
          )}
        >
          <SocialLoginButtons
            githubAvailable={githubAvailable}
            googleAvailable={googleAvailable}
            callbackURL={redirectUrl || '/workspace'}
            isProduction={isProduction}
          >
            {isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED')) && (
              <SSOLoginButton callbackURL={redirectUrl || '/workspace'} variant='outline' />
            )}
          </SocialLoginButtons>
        </div>
      )}

      <div className='pt-6 text-center font-light text-sm'>
        <span className='font-normal'>Already have an account? </span>
        <Link
          href={isInviteFlow ? `/login?invite_flow=true&callbackUrl=${redirectUrl}` : '/login'}
          className='font-medium text-[var(--landing-text)] underline-offset-4 transition hover:text-white hover:underline'
        >
          Sign in
        </Link>
      </div>

      <div className='absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[var(--landing-text-muted)] text-small leading-relaxed sm:px-8 md:px-11'>
        By creating an account, you agree to our{' '}
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

export default function SignupPage({
  githubAvailable,
  googleAvailable,
  isProduction,
}: {
  githubAvailable: boolean
  googleAvailable: boolean
  isProduction: boolean
}) {
  return (
    <Suspense
      fallback={<div className='flex h-screen items-center justify-center'>Loading...</div>}
    >
      <SignupFormContent
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        isProduction={isProduction}
      />
    </Suspense>
  )
}
