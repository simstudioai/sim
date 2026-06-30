'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import { forgetPasswordContract } from '@/lib/api/contracts'
import { client } from '@/lib/auth/auth-client'
import { getEnv, isFalsy, isTruthy } from '@/lib/core/config/env'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { captureClientEvent } from '@/lib/posthog/client'
import {
  AuthDivider,
  AuthField,
  AuthFormMessage,
  AuthHeader,
  AuthInput,
  AuthLegalFooter,
  AuthNavPrompt,
  AuthSubmitButton,
  AuthTextLink,
  PasswordInput,
  SocialLoginButtons,
  SSOLoginButton,
} from '@/app/(auth)/components'

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
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
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

  useEffect(() => {
    captureClientEvent('login_page_viewed', {})
  }, [])

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

      const result = await client.signIn.email(
        {
          email,
          password,
          callbackURL: safeCallbackUrl,
        },
        {
          onError: (ctx: any) => {
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

      try {
        await requestJson(forgetPasswordContract, {
          body: {
            email: forgotPasswordEmail,
            redirectTo: `${getBaseUrl()}/reset-password`,
          },
        })
      } catch (requestError) {
        let errorMessage = getErrorMessage(requestError, 'Failed to request password reset')

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
        message: getErrorMessage(error, 'Failed to request password reset'),
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

  const emailFieldErrors = showEmailValidationError && emailErrors.length > 0 ? emailErrors : []
  const passwordFieldErrors = showValidationError && passwordErrors.length > 0 ? passwordErrors : []
  const canSubmit = email.trim().length > 0 && password.length > 0

  return (
    <>
      <div className='space-y-6'>
        <AuthHeader title='Sign in' description='Enter your details' />

        {showTopSSO && <SSOLoginButton callbackURL={callbackUrl} variant='primary' />}

        {emailEnabled && (
          <form onSubmit={onSubmit} className='space-y-6'>
            <div className='space-y-5'>
              <AuthField htmlFor='email' label='Email' errors={emailFieldErrors}>
                <AuthInput
                  id='email'
                  name='email'
                  placeholder='Enter your email'
                  required
                  autoCapitalize='none'
                  autoComplete='email'
                  autoCorrect='off'
                  value={email}
                  onChange={handleEmailChange}
                  error={emailFieldErrors.length > 0}
                />
              </AuthField>
              <AuthField
                htmlFor='password'
                label='Password'
                errors={passwordFieldErrors}
                action={
                  <AuthTextLink
                    onClick={() => setForgotPasswordOpen(true)}
                    className='text-caption'
                  >
                    Forgot password?
                  </AuthTextLink>
                }
              >
                <PasswordInput
                  id='password'
                  name='password'
                  required
                  autoCapitalize='none'
                  autoComplete='current-password'
                  autoCorrect='off'
                  placeholder='Enter your password'
                  value={password}
                  onChange={handlePasswordChange}
                  error={passwordFieldErrors.length > 0}
                />
              </AuthField>
            </div>

            {resetSuccessMessage && (
              <AuthFormMessage type='success'>
                <p>{resetSuccessMessage}</p>
              </AuthFormMessage>
            )}

            <AuthSubmitButton loading={isLoading} loadingLabel='Signing in…' disabled={!canSubmit}>
              Sign in
            </AuthSubmitButton>
          </form>
        )}

        {showDivider && <AuthDivider label='Or continue with' />}

        {showBottomSection && (
          <SocialLoginButtons
            googleAvailable={googleAvailable}
            githubAvailable={githubAvailable}
            isProduction={isProduction}
            callbackURL={callbackUrl}
          >
            {ssoEnabled && !hasOnlySSO && (
              <SSOLoginButton callbackURL={callbackUrl} variant='outline' />
            )}
          </SocialLoginButtons>
        )}

        {emailEnabled && (
          <AuthNavPrompt
            prompt="Don't have an account?"
            href={isInviteFlow ? `/signup?invite_flow=true&callbackUrl=${callbackUrl}` : '/signup'}
            linkLabel='Sign up'
          />
        )}

        <AuthLegalFooter action='signing in' />
      </div>

      <ChipModal
        open={forgotPasswordOpen}
        onOpenChange={setForgotPasswordOpen}
        srTitle='Reset Password'
      >
        <ChipModalHeader onClose={() => setForgotPasswordOpen(false)}>
          Reset Password
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            Enter your email address and we'll send you a link to reset your password if your
            account exists.
          </p>
          <ChipModalField
            type='email'
            title='Email'
            value={forgotPasswordEmail}
            onChange={(value) => setForgotPasswordEmail(value)}
            onSubmit={() => {
              if (!isSubmittingReset) void handleForgotPassword()
            }}
            required
            placeholder='you@example.com'
          />
          {resetStatus.type === 'success' && (
            <p className='px-2 text-[var(--text-secondary)] text-sm'>{resetStatus.message}</p>
          )}
          <ChipModalError>
            {resetStatus.type === 'error' ? resetStatus.message : null}
          </ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setForgotPasswordOpen(false)}
          cancelDisabled={isSubmittingReset}
          primaryAction={{
            label: isSubmittingReset ? 'Sending…' : 'Send Reset Link',
            onClick: handleForgotPassword,
            disabled: !forgotPasswordEmail || isSubmittingReset,
          }}
        />
      </ChipModal>
    </>
  )
}
