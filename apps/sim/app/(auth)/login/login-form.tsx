'use client'

import { useRef, useState } from 'react'
import { AuthStack } from '@sim/auth-ui'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeEmail } from '@sim/utils/string'
import { useRouter, useSearchParams } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { forgetPasswordContract } from '@/lib/api/contracts'
import { client } from '@/lib/auth/client'
import { getEnv, isFalsy } from '@/lib/core/config/env'
import { isSsoEnabled } from '@/lib/core/config/env-flags'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { DEFAULT_POST_AUTH_ROUTE, POST_AUTH_REDIRECT_STORAGE_KEY } from '@/app/(auth)/auth-redirect'
import {
  AuthDivider,
  AuthEmailInput,
  AuthField,
  AuthFormMessage,
  AuthHeader,
  AuthLegalFooter,
  AuthSubmitButton,
  AuthTextLink,
  PasswordInput,
  SocialLoginButtons,
  SSOLoginButton,
} from '@/app/(auth)/components'
import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'

const logger = createLogger('LoginForm')

const validateEmailField = (emailValue: string): string[] => {
  const errors: string[] = []

  if (!emailValue || !emailValue.trim()) {
    errors.push('Email is required.')
    return errors
  }

  const validation = quickValidateEmail(normalizeEmail(emailValue))
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
  microsoftAvailable,
}: {
  githubAvailable: boolean
  googleAvailable: boolean
  microsoftAvailable: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  useCaptureWhenReady('login_page_viewed', {})
  const [isLoading, setIsLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  /** A refusal that is about the account or its organization, not the credentials typed in. */
  const [policyError, setPolicyError] = useState<string | null>(null)
  const callbackUrlParam = searchParams?.get('callbackUrl')
  const isValidCallbackUrl = callbackUrlParam ? validateCallbackUrl(callbackUrlParam) : false
  const invalidCallbackRef = useRef(false)
  if (callbackUrlParam && !isValidCallbackUrl && !invalidCallbackRef.current) {
    invalidCallbackRef.current = true
    logger.warn('Invalid callback URL detected and blocked:', { url: callbackUrlParam })
  }
  const callbackUrl = isValidCallbackUrl ? callbackUrlParam! : DEFAULT_POST_AUTH_ROUTE

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
    if (isLoading) return
    setIsLoading(true)
    setPolicyError(null)

    const redirectToVerify = (emailToVerify: string) => {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('verificationEmail', emailToVerify)
        sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, callbackUrl)
      }
      router.push('/verify')
    }

    const formData = new FormData(e.currentTarget)
    const emailRaw = formData.get('email') as string
    const email = normalizeEmail(emailRaw)

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

            /**
             * A policy refusal explains itself — an organization requiring single sign-on, or a
             * suspended account. It belongs in the form-level slot: the password is not what is
             * wrong, so marking that field would send the person to reset a password that is fine.
             */
            if (ctx.error.status === 403 && ctx.error.message) {
              errorHandled = true
              setResetSuccessMessage(null)
              setPasswordErrors([])
              setShowValidationError(false)
              setPolicyError(ctx.error.message)
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

      /** Fallback when better-auth does not redirect: a document navigation, like signup's, so the workspace shell initializes its own theme store. */
      window.location.href = safeCallbackUrl
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
    if (isSubmittingReset) return
    if (!forgotPasswordEmail) {
      setResetStatus({
        type: 'error',
        message: 'Please enter your email address',
      })
      return
    }

    const emailValidation = quickValidateEmail(normalizeEmail(forgotPasswordEmail))
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
          setResetStatus({
            type: 'success',
            message: 'If an account exists for this email, you will receive a password reset link.',
          })
          return
        }

        throw new Error(errorMessage)
      }

      setResetStatus({
        type: 'success',
        message: 'If an account exists for this email, you will receive a password reset link.',
      })
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

  const ssoEnabled = isSsoEnabled
  const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))
  const hasSocial = githubAvailable || googleAvailable || microsoftAvailable
  const hasOnlySSO = ssoEnabled && !emailEnabled && !hasSocial
  const showTopSSO = hasOnlySSO
  const showBottomSection = hasSocial || (ssoEnabled && !hasOnlySSO)
  const showDivider = (emailEnabled || showTopSSO) && showBottomSection

  const emailFieldErrors = showEmailValidationError && emailErrors.length > 0 ? emailErrors : []
  const passwordFieldErrors = showValidationError && passwordErrors.length > 0 ? passwordErrors : []
  const canSubmit = email.trim().length > 0 && password.length > 0

  if (!emailEnabled && !ssoEnabled && !hasSocial)
    return (
      <AuthHeader
        title='Sign-in is unavailable'
        description='No sign-in methods are available on this deployment. Ask your administrator to enable a sign-in method.'
      />
    )

  if (forgotPasswordOpen)
    return (
      <AuthStack>
        <AuthHeader
          title='Reset your password'
          description='Enter your email and we’ll send you a reset link if an account exists.'
        />
        <form
          className='au:space-y-5'
          onSubmit={(event) => {
            event.preventDefault()
            void handleForgotPassword()
          }}
        >
          <AuthField htmlFor='recovery-email' label='Email'>
            <AuthEmailInput
              id='recovery-email'
              name='email'
              type='email'
              autoFocus
              value={forgotPasswordEmail}
              disabled={isSubmittingReset}
              onChange={(event) => {
                setForgotPasswordEmail(event.target.value)
                setResetStatus({ type: null, message: '' })
              }}
            />
          </AuthField>
          {resetStatus.type && (
            <AuthFormMessage type={resetStatus.type}>{resetStatus.message}</AuthFormMessage>
          )}
          <AuthSubmitButton
            loading={isSubmittingReset}
            loadingLabel='Sending…'
            disabled={!forgotPasswordEmail.trim()}
          >
            Send reset link
          </AuthSubmitButton>
        </form>
        <AuthTextLink
          disabled={isSubmittingReset}
          onClick={() => {
            setEmail(forgotPasswordEmail)
            setForgotPasswordOpen(false)
          }}
        >
          Back to sign in
        </AuthTextLink>
      </AuthStack>
    )

  return (
    <>
      <div className='au:space-y-[var(--auth-group-gap)]'>
        <AuthHeader title='Sign in' description='Welcome back to Sim.' />

        {showTopSSO && (
          <SSOLoginButton callbackURL={callbackUrl} variant='primary' disabled={isLoading} />
        )}

        {emailEnabled && (
          <form onSubmit={onSubmit} className='au:space-y-[var(--auth-group-gap)]'>
            <div className='au:space-y-5'>
              <AuthField htmlFor='email' label='Email' errors={emailFieldErrors}>
                <AuthEmailInput
                  id='email'
                  name='email'
                  required
                  disabled={isLoading}
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
                    disabled={isLoading}
                    onClick={() => {
                      setForgotPasswordEmail(email)
                      setResetStatus({ type: null, message: '' })
                      setForgotPasswordOpen(true)
                    }}
                    className='au:text-caption'
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
                  disabled={isLoading}
                  value={password}
                  onChange={handlePasswordChange}
                  error={passwordFieldErrors.length > 0}
                />
              </AuthField>
            </div>

            {policyError && (
              <AuthFormMessage type='error'>
                <p>{policyError}</p>
              </AuthFormMessage>
            )}

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
            view='login'
            googleAvailable={googleAvailable}
            githubAvailable={githubAvailable}
            microsoftAvailable={microsoftAvailable}
            callbackURL={callbackUrl}
            ssoEnabled={ssoEnabled && !hasOnlySSO}
            disabled={isLoading}
          />
        )}

        <AuthLegalFooter action='signing in' />
      </div>
    </>
  )
}
