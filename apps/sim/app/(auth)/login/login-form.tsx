'use client'

import { useMemo, useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { createLogger } from '@sim/logger'
import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
} from '@/components/emcn'
import { client } from '@/lib/auth/auth-client'
import { getEnv, isFalsy, isTruthy } from '@/lib/core/config/env'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { SSOLoginButton } from '@/app/(auth)/components/sso-login-button'
import { useBrandedButtonClass } from '@/hooks/use-branded-button-class'

const logger = createLogger('LoginForm')

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

const PASSWORD_VALIDATIONS = {
  required: {
    test: (value: string) => Boolean(value && typeof value === 'string'),
    message: 'Password is required.',
  },
  notEmpty: {
    test: (value: string) => value.trim().length > 0,
    message: 'Password cannot be empty.',
  },
}

const validatePassword = (passwordValue: string): string[] => {
  const errors: string[] = []

  if (!PASSWORD_VALIDATIONS.required.test(passwordValue)) {
    errors.push(PASSWORD_VALIDATIONS.required.message)
    return errors
  }

  if (!PASSWORD_VALIDATIONS.notEmpty.test(passwordValue)) {
    errors.push(PASSWORD_VALIDATIONS.notEmpty.message)
    return errors
  }

  return errors
}

export default function LoginPage({
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
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileInstance>(null)
  const turnstileSiteKey = useMemo(() => getEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY'), [])
  const buttonClass = useBrandedButtonClass()

  const callbackUrlParam = searchParams?.get('callbackUrl')
  const isValidCallbackUrl = callbackUrlParam ? validateCallbackUrl(callbackUrlParam) : false
  const invalidCallbackRef = useRef(false)
  if (callbackUrlParam && !isValidCallbackUrl && !invalidCallbackRef.current) {
    invalidCallbackRef.current = true
    logger.warn('Invalid callback URL detected and blocked:', { url: callbackUrlParam })
  }
  const callbackUrl = isValidCallbackUrl ? callbackUrlParam! : '/workspace'
  const isInviteFlow = searchParams?.get('invite_flow') === 'true'

  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [isSubmittingReset, setIsSubmittingReset] = useState(false)
  const [resetStatus, setResetStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(() =>
    searchParams?.get('resetSuccess') === 'true'
      ? 'Password reset successful. Please sign in with your new password.'
      : null
  )

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    const errors = validateEmailField(newEmail)
    setEmailErrors(errors)
    setShowEmailValidationError(false)
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)

    const errors = validatePassword(newPassword)
    setPasswordErrors(errors)
    setShowValidationError(false)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const redirectToVerify = (emailToVerify: string) => {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('verificationEmail', emailToVerify)
      }
      router.push('/verify')
    }

    const formData = new FormData(e.currentTarget)
    const emailRaw = formData.get('email') as string
    const email = emailRaw.trim().toLowerCase()

    const emailValidationErrors = validateEmailField(email)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    const passwordValidationErrors = validatePassword(password)
    setPasswordErrors(passwordValidationErrors)
    setShowValidationError(passwordValidationErrors.length > 0)

    if (emailValidationErrors.length > 0 || passwordValidationErrors.length > 0) {
      setIsLoading(false)
      return
    }

    try {
      const safeCallbackUrl = callbackUrl
      let errorHandled = false

      // Execute Turnstile challenge on submit and get a fresh token
      let token: string | undefined
      if (turnstileSiteKey && turnstileRef.current) {
        try {
          turnstileRef.current.reset()
          turnstileRef.current.execute()
          token = await turnstileRef.current.getResponsePromise(15_000)
        } catch {
          setFormError('Captcha verification failed. Please try again.')
          setIsLoading(false)
          return
        }
      }

      setFormError(null)
      const result = await client.signIn.email(
        {
          email,
          password,
          callbackURL: safeCallbackUrl,
        },
        {
          fetchOptions: {
            headers: {
              ...(token ? { 'x-captcha-response': token } : {}),
            },
          },
          onError: (ctx) => {
            logger.error('Login error:', ctx.error)

            if (ctx.error.code?.includes('EMAIL_NOT_VERIFIED')) {
              errorHandled = true
              redirectToVerify(email)
              return
            }

            errorHandled = true
            const errorMessage: string[] = ['Invalid email or password']

            if (
              ctx.error.code?.includes('BAD_REQUEST') ||
              ctx.error.message?.includes('Email and password sign in is not enabled')
            ) {
              errorMessage.push('Email sign in is currently disabled.')
            } else if (
              ctx.error.code?.includes('INVALID_CREDENTIALS') ||
              ctx.error.message?.includes('invalid password')
            ) {
              errorMessage.push('Invalid email or password. Please try again.')
            } else if (
              ctx.error.code?.includes('USER_NOT_FOUND') ||
              ctx.error.message?.includes('not found')
            ) {
              errorMessage.push('No account found with this email. Please sign up first.')
            } else if (ctx.error.code?.includes('MISSING_CREDENTIALS')) {
              errorMessage.push('Please enter both email and password.')
            } else if (ctx.error.code?.includes('EMAIL_PASSWORD_DISABLED')) {
              errorMessage.push('Email and password login is disabled.')
            } else if (ctx.error.code?.includes('FAILED_TO_CREATE_SESSION')) {
              errorMessage.push('Failed to create session. Please try again later.')
            } else if (ctx.error.code?.includes('too many attempts')) {
              errorMessage.push(
                'Too many login attempts. Please try again later or reset your password.'
              )
            } else if (ctx.error.code?.includes('account locked')) {
              errorMessage.push(
                'Your account has been locked for security. Please reset your password.'
              )
            } else if (ctx.error.code?.includes('network')) {
              errorMessage.push('Network error. Please check your connection and try again.')
            } else if (ctx.error.message?.includes('rate limit')) {
              errorMessage.push('Too many requests. Please wait a moment before trying again.')
            }

            setResetSuccessMessage(null)
            setPasswordErrors(errorMessage)
            setShowValidationError(true)
          },
        }
      )

      if (!result || result.error) {
        // Show error if not already handled by onError callback
        if (!errorHandled) {
          setResetSuccessMessage(null)
          const errorMessage = result?.error?.message || 'Login failed. Please try again.'
          setPasswordErrors([errorMessage])
          setShowValidationError(true)
        }
        setIsLoading(false)
        return
      }

      // Clear reset success message on successful login
      setResetSuccessMessage(null)

      // Explicit redirect fallback if better-auth doesn't redirect
      router.push(safeCallbackUrl)
    } catch (err: any) {
      if (err.message?.includes('not verified') || err.code?.includes('EMAIL_NOT_VERIFIED')) {
        redirectToVerify(email)
        return
      }

      logger.error('Uncaught login error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!forgotPasswordEmail) {
      setResetStatus({
        type: 'error',
        message: 'Please enter your email address',
      })
      return
    }

    const emailValidation = quickValidateEmail(forgotPasswordEmail.trim().toLowerCase())
    if (!emailValidation.isValid) {
      setResetStatus({
        type: 'error',
        message: 'Please enter a valid email address',
      })
      return
    }

    try {
      setIsSubmittingReset(true)
      setResetStatus({ type: null, message: '' })

      const response = await fetch('/api/auth/forget-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: forgotPasswordEmail,
          redirectTo: `${getBaseUrl()}/reset-password`,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        let errorMessage = errorData.message || 'Failed to request password reset'

        if (
          errorMessage.includes('Invalid body parameters') ||
          errorMessage.includes('invalid email')
        ) {
          errorMessage = 'Please enter a valid email address'
        } else if (errorMessage.includes('Email is required')) {
          errorMessage = 'Please enter your email address'
        } else if (
          errorMessage.includes('user not found') ||
          errorMessage.includes('User not found')
        ) {
          errorMessage = 'No account found with this email address'
        }

        throw new Error(errorMessage)
      }

      setResetStatus({
        type: 'success',
        message: 'Password reset link sent to your email',
      })

      setTimeout(() => {
        setForgotPasswordOpen(false)
        setResetStatus({ type: null, message: '' })
      }, 2000)
    } catch (error) {
      logger.error('Error requesting password reset:', { error })
      setResetStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to request password reset',
      })
    } finally {
      setIsSubmittingReset(false)
    }
  }

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))
  const hasSocial = githubAvailable || googleAvailable
  const hasOnlySSO = ssoEnabled && !emailEnabled && !hasSocial
  const showTopSSO = hasOnlySSO
  const showBottomSection = hasSocial || (ssoEnabled && !hasOnlySSO)
  const showDivider = (emailEnabled || showTopSSO) && showBottomSection

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
          Sign in
        </h1>
        <p className='font-[430] font-season text-[#F6F6F6]/60 text-[18px] leading-[125%] tracking-[0.02em]'>
          Enter your details
        </p>
      </div>

      {/* SSO Login Button (primary top-only when it is the only method) */}
      {showTopSSO && (
        <div className='mt-8'>
          <SSOLoginButton
            callbackURL={callbackUrl}
            variant='primary'
            primaryClassName={buttonClass}
          />
        </div>
      )}

      {/* Password reset success message */}
      {resetSuccessMessage && (
        <div className='mt-1 space-y-1 text-[#4CAF50] text-xs'>
          <p>{resetSuccessMessage}</p>
        </div>
      )}

      {/* Email/Password Form - show unless explicitly disabled */}
      {!isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED')) && (
        <form onSubmit={onSubmit} className='mt-8 space-y-8'>
          <div className='space-y-6'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='email'>Email</Label>
              </div>
              <Input
                id='email'
                name='email'
                placeholder='Enter your email'
                required
                autoCapitalize='none'
                autoComplete='email'
                autoCorrect='off'
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
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='password'>Password</Label>
                <button
                  type='button'
                  onClick={() => setForgotPasswordOpen(true)}
                  className='font-medium text-[#999] text-xs transition hover:text-[#ECECEC]'
                >
                  Forgot password?
                </button>
              </div>
              <div className='relative'>
                <Input
                  id='password'
                  name='password'
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoCapitalize='none'
                  autoComplete='current-password'
                  autoCorrect='off'
                  placeholder='Enter your password'
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
                  className='-translate-y-1/2 absolute top-1/2 right-3 text-[#999] transition hover:text-[#ECECEC]'
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {showValidationError && passwordErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {passwordErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {turnstileSiteKey && (
            <Turnstile
              ref={turnstileRef}
              siteKey={turnstileSiteKey}
              options={{ size: 'invisible', execution: 'execute' }}
            />
          )}

          {formError && (
            <div className='text-red-400 text-xs'>
              <p>{formError}</p>
            </div>
          )}

          <BrandedButton
            type='submit'
            disabled={isLoading}
            loading={isLoading}
            loadingText='Signing in'
          >
            Sign in
          </BrandedButton>
        </form>
      )}

      {/* Divider - show when we have multiple auth methods */}
      {showDivider && (
        <div className='relative my-6 font-light'>
          <div className='absolute inset-0 flex items-center'>
            <div className='w-full border-[#2A2A2A] border-t' />
          </div>
          <div className='relative flex justify-center text-sm'>
            <span className='bg-[#1C1C1C] px-4 font-[340] text-[#999]'>Or continue with</span>
          </div>
        </div>
      )}

      {showBottomSection && (
        <div className={cn(!emailEnabled ? 'mt-8' : undefined)}>
          <SocialLoginButtons
            googleAvailable={googleAvailable}
            githubAvailable={githubAvailable}
            isProduction={isProduction}
            callbackURL={callbackUrl}
          >
            {ssoEnabled && !hasOnlySSO && (
              <SSOLoginButton
                callbackURL={callbackUrl}
                variant='outline'
                primaryClassName={buttonClass}
              />
            )}
          </SocialLoginButtons>
        </div>
      )}

      {/* Only show signup link if email/password signup is enabled */}
      {!isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED')) && (
        <div className='pt-6 text-center font-light text-[14px]'>
          <span className='font-normal'>Don't have an account? </span>
          <Link
            href={isInviteFlow ? `/signup?invite_flow=true&callbackUrl=${callbackUrl}` : '/signup'}
            className='font-medium text-[#ECECEC] underline-offset-4 transition hover:text-white hover:underline'
          >
            Sign up
          </Link>
        </div>
      )}

      <div className='absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[#999] text-[13px] leading-relaxed sm:px-8 md:px-[44px]'>
        By signing in, you agree to our{' '}
        <Link
          href='/terms'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[#999] underline-offset-4 transition hover:text-[#ECECEC] hover:underline'
        >
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link
          href='/privacy'
          target='_blank'
          rel='noopener noreferrer'
          className='text-[#999] underline-offset-4 transition hover:text-[#ECECEC] hover:underline'
        >
          Privacy Policy
        </Link>
      </div>

      <Modal open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <ModalContent className='dark' size='sm'>
          <ModalHeader>Reset Password</ModalHeader>
          <ModalBody>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleForgotPassword()
              }}
            >
              <ModalDescription className='mb-4 text-[var(--text-muted)] text-sm'>
                Enter your email address and we'll send you a link to reset your password if your
                account exists.
              </ModalDescription>
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <Label htmlFor='reset-email'>Email</Label>
                  <Input
                    id='reset-email'
                    value={forgotPasswordEmail}
                    onChange={(e) => setForgotPasswordEmail(e.target.value)}
                    placeholder='Enter your email'
                    required
                    type='email'
                    className={cn(
                      resetStatus.type === 'error' && 'border-red-500 focus:border-red-500'
                    )}
                  />
                  {resetStatus.type === 'error' && (
                    <div className='mt-1 text-red-400 text-xs'>
                      <p>{resetStatus.message}</p>
                    </div>
                  )}
                </div>
                {resetStatus.type === 'success' && (
                  <div className='mt-1 text-[#4CAF50] text-xs'>
                    <p>{resetStatus.message}</p>
                  </div>
                )}
                <BrandedButton
                  type='submit'
                  disabled={isSubmittingReset}
                  loading={isSubmittingReset}
                  loadingText='Sending'
                >
                  Send Reset Link
                </BrandedButton>
              </div>
            </form>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}
