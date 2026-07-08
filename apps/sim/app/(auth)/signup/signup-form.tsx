'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { createLogger } from '@sim/logger'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { client, useSession } from '@/lib/auth/auth-client'
import { getEnv, isFalsy, isTruthy } from '@/lib/core/config/env'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { captureClientEvent, captureEvent } from '@/lib/posthog/client'
import {
  AuthDivider,
  AuthField,
  AuthFormMessage,
  AuthHeader,
  AuthInput,
  AuthLegalFooter,
  AuthNavPrompt,
  AuthSubmitButton,
  PasswordInput,
  SocialLoginButtons,
  SSOLoginButton,
} from '@/app/(auth)/components'

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

interface SignupFormProps {
  githubAvailable: boolean
  googleAvailable: boolean
  microsoftAvailable: boolean
  isProduction: boolean
  emailSignupEnabled: boolean
}

function SignupFormContent({
  githubAvailable,
  googleAvailable,
  microsoftAvailable,
  isProduction,
  emailSignupEnabled,
}: SignupFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refetch: refetchSession } = useSession()
  const posthog = usePostHog()
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    captureClientEvent('signup_page_viewed', {})
  }, [])
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '')
  const [emailError, setEmailError] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileInstance>(null)
  const [turnstileSiteKey] = useState(() => getEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY'))
  const rawRedirectUrl = searchParams.get('redirect') || searchParams.get('callbackUrl') || ''
  const isValidRedirectUrl = rawRedirectUrl ? validateCallbackUrl(rawRedirectUrl) : false
  const invalidCallbackRef = useRef(false)
  if (rawRedirectUrl && !isValidRedirectUrl && !invalidCallbackRef.current) {
    invalidCallbackRef.current = true
    logger.warn('Invalid callback URL detected and blocked:', { url: rawRedirectUrl })
  }
  const redirectUrl = isValidRedirectUrl ? rawRedirectUrl : ''
  const isInviteFlow = useMemo(
    () => searchParams.get('invite_flow') === 'true' || redirectUrl.startsWith('/invite/'),
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
          name: trimmedName,
        },
        {
          headers: {
            ...(token ? { 'x-captcha-response': token } : {}),
          },
          onError: (ctx) => {
            logger.warn('Signup error:', ctx.error)
            const errorMessage: string[] = ['Failed to create account']

            let errorCode = 'unknown'
            if (ctx.error.code?.includes('USER_ALREADY_EXISTS')) {
              errorCode = 'user_already_exists'
              setEmailError('An account with this email already exists. Please sign in instead.')
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

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const emailEnabled =
    !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED')) && emailSignupEnabled
  const hasSocial = githubAvailable || googleAvailable || microsoftAvailable
  const hasOnlySSO = ssoEnabled && !emailEnabled && !hasSocial
  const showBottomSection = hasSocial || (ssoEnabled && !hasOnlySSO)
  const showDivider = (emailEnabled || hasOnlySSO) && showBottomSection

  const nameFieldErrors = showNameValidationError && nameErrors.length > 0 ? nameErrors : []
  const emailHasError = Boolean(emailError) || (showEmailValidationError && emailErrors.length > 0)
  const emailFieldErrors =
    showEmailValidationError && emailErrors.length > 0
      ? emailErrors
      : emailError && !showEmailValidationError
        ? [emailError]
        : []
  const passwordFieldErrors = showValidationError && passwordErrors.length > 0 ? passwordErrors : []
  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && password.length > 0

  return (
    <div className='space-y-6'>
      <AuthHeader title='Create an account' description='Create an account or log in' />

      {hasOnlySSO && <SSOLoginButton callbackURL={redirectUrl || '/workspace'} variant='primary' />}

      {emailEnabled && (
        <form onSubmit={onSubmit} className='space-y-6'>
          <div className='space-y-5'>
            <AuthField htmlFor='name' label='Full name' errors={nameFieldErrors}>
              <AuthInput
                id='name'
                name='name'
                placeholder='Enter your name'
                type='text'
                autoCapitalize='words'
                autoComplete='name'
                title='Name can only contain letters, spaces, hyphens, and apostrophes'
                value={name}
                onChange={handleNameChange}
                error={nameFieldErrors.length > 0}
              />
            </AuthField>
            <AuthField htmlFor='email' label='Email' errors={emailFieldErrors}>
              <AuthInput
                id='email'
                name='email'
                placeholder='Enter your email'
                autoCapitalize='none'
                autoComplete='email'
                autoCorrect='off'
                value={email}
                onChange={handleEmailChange}
                error={emailHasError}
              />
            </AuthField>
            <AuthField htmlFor='password' label='Password' errors={passwordFieldErrors}>
              <PasswordInput
                id='password'
                name='password'
                autoCapitalize='none'
                autoComplete='new-password'
                placeholder='Enter your password'
                autoCorrect='off'
                value={password}
                onChange={handlePasswordChange}
                error={passwordFieldErrors.length > 0}
              />
            </AuthField>
          </div>

          {turnstileSiteKey && (
            <Turnstile
              ref={turnstileRef}
              siteKey={turnstileSiteKey}
              options={{ execution: 'execute', appearance: 'execute' }}
            />
          )}

          {formError && (
            <AuthFormMessage type='error'>
              <p>{formError}</p>
            </AuthFormMessage>
          )}

          <AuthSubmitButton
            loading={isLoading}
            loadingLabel='Creating account…'
            disabled={!canSubmit}
          >
            Create account
          </AuthSubmitButton>
        </form>
      )}

      {showDivider && <AuthDivider label='Or continue with' />}

      {showBottomSection && (
        <SocialLoginButtons
          githubAvailable={githubAvailable}
          googleAvailable={googleAvailable}
          microsoftAvailable={microsoftAvailable}
          callbackURL={redirectUrl || '/workspace'}
          isProduction={isProduction}
        >
          {ssoEnabled && !hasOnlySSO && (
            <SSOLoginButton callbackURL={redirectUrl || '/workspace'} variant='outline' />
          )}
        </SocialLoginButtons>
      )}

      <AuthNavPrompt
        prompt='Already have an account?'
        href={isInviteFlow ? `/login?invite_flow=true&callbackUrl=${redirectUrl}` : '/login'}
        linkLabel='Sign in'
      />

      <AuthLegalFooter action='creating an account' />
    </div>
  )
}

export default function SignupPage({
  githubAvailable,
  googleAvailable,
  microsoftAvailable,
  isProduction,
  emailSignupEnabled,
}: SignupFormProps) {
  return (
    <Suspense fallback={<div className='flex h-screen items-center justify-center'>Loading…</div>}>
      <SignupFormContent
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        microsoftAvailable={microsoftAvailable}
        isProduction={isProduction}
        emailSignupEnabled={emailSignupEnabled}
      />
    </Suspense>
  )
}
