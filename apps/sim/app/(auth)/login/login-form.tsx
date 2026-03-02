'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth/auth-client'
import { getEnv, isFalsy, isTruthy } from '@/lib/core/config/env'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { SSOLoginButton } from '@/app/(auth)/components/sso-login-button'
import { useBrandedButtonClass } from '@/hooks/use-branded-button-class'
import { useTranslations } from 'next-intl'

const logger = createLogger('LoginForm')

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

function useLoginValidation() {
  const t = useTranslations()

  const validateEmailField = (emailValue: string): string[] => {
    const errors: string[] = []

    if (!emailValue || !emailValue.trim()) {
      errors.push(t('sign_in.errors.email_required'))
      return errors
    }

    const validation = quickValidateEmail(emailValue.trim().toLowerCase())
    if (!validation.isValid) {
      errors.push(validation.reason || t('sign_in.errors.email_invalid'))
    }

    return errors
  }

  const validatePassword = (passwordValue: string): string[] => {
    const errors: string[] = []

    if (!Boolean(passwordValue && typeof passwordValue === 'string')) {
      errors.push(t('sign_in.errors.password_required'))
      return errors
    }

    if (!(passwordValue.trim().length > 0)) {
      errors.push(t('sign_in.errors.password_not_empty'))
      return errors
    }

    return errors
  }

  return { validateEmailField, validatePassword }
}

function useLoginErrorMessages() {
  const t = useTranslations()

  return {
    invalidCredentials: t('sign_in.errors.invalid_credentials'),
    emailSignInDisabled: t('sign_in.errors.email_sign_in_disabled'),
    invalidCredentialsRetry: t('sign_in.errors.invalid_credentials_retry'),
    noAccountFound: t('sign_in.errors.no_account_found'),
    missingCredentials: t('sign_in.errors.missing_credentials'),
    emailPasswordDisabled: t('sign_in.errors.email_password_disabled'),
    failedToCreateSession: t('sign_in.errors.failed_to_create_session'),
    tooManyAttempts: t('sign_in.errors.too_many_attempts'),
    accountLocked: t('sign_in.errors.account_locked'),
    networkError: t('sign_in.errors.network_error'),
    rateLimit: t('sign_in.errors.rate_limit'),
    loginFailed: t('sign_in.errors.login_failed'),
    resetSuccess: t('sign_in.messages.reset_success'),
  }
}

function useResetPasswordMessages() {
  const t = useTranslations()

  return {
    enterEmail: t('sign_in.reset_password.errors.enter_email'),
    invalidEmail: t('sign_in.reset_password.errors.invalid_email'),
    noAccountFound: t('sign_in.reset_password.errors.no_account_found'),
    failed: t('sign_in.reset_password.errors.failed'),
    success: t('sign_in.reset_password.messages.success'),
  }
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
  const t = useTranslations()
  const { validateEmailField, validatePassword } = useLoginValidation()
  const loginErrors = useLoginErrorMessages()
  const resetMessages = useResetPasswordMessages()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [_mounted, setMounted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const buttonClass = useBrandedButtonClass()

  const [callbackUrl, setCallbackUrl] = useState('/workspace')
  const [isInviteFlow, setIsInviteFlow] = useState(false)

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
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)

    if (searchParams) {
      const callback = searchParams.get('callbackUrl')
      if (callback) {
        if (validateCallbackUrl(callback)) {
          setCallbackUrl(callback)
        } else {
          logger.warn('Invalid callback URL detected and blocked:', { url: callback })
        }
      }

      const inviteFlow = searchParams.get('invite_flow') === 'true'
      setIsInviteFlow(inviteFlow)

      const resetSuccess = searchParams.get('resetSuccess') === 'true'
      if (resetSuccess) {
        setResetSuccessMessage(loginErrors.resetSuccess)
      }
    }
  }, [searchParams])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && forgotPasswordOpen) {
        handleForgotPassword()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [forgotPasswordEmail, forgotPasswordOpen])

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
      const safeCallbackUrl = validateCallbackUrl(callbackUrl) ? callbackUrl : '/workspace'
      let errorHandled = false

      const result = await client.signIn.email(
        {
          email,
          password,
          callbackURL: safeCallbackUrl,
        },
        {
          onError: (ctx) => {
            logger.error('Login error:', ctx.error)

            if (ctx.error.code?.includes('EMAIL_NOT_VERIFIED')) {
              errorHandled = true
              redirectToVerify(email)
              return
            }

            errorHandled = true
            const errorMessage: string[] = [loginErrors.invalidCredentials]

            if (
              ctx.error.code?.includes('BAD_REQUEST') ||
              ctx.error.message?.includes('Email and password sign in is not enabled')
            ) {
              errorMessage.push(loginErrors.emailSignInDisabled)
            } else if (
              ctx.error.code?.includes('INVALID_CREDENTIALS') ||
              ctx.error.message?.includes('invalid password')
            ) {
              errorMessage.push(loginErrors.invalidCredentialsRetry)
            } else if (
              ctx.error.code?.includes('USER_NOT_FOUND') ||
              ctx.error.message?.includes('not found')
            ) {
              errorMessage.push(loginErrors.noAccountFound)
            } else if (ctx.error.code?.includes('MISSING_CREDENTIALS')) {
              errorMessage.push(loginErrors.missingCredentials)
            } else if (ctx.error.code?.includes('EMAIL_PASSWORD_DISABLED')) {
              errorMessage.push(loginErrors.emailPasswordDisabled)
            } else if (ctx.error.code?.includes('FAILED_TO_CREATE_SESSION')) {
              errorMessage.push(loginErrors.failedToCreateSession)
            } else if (ctx.error.code?.includes('too many attempts')) {
              errorMessage.push(loginErrors.tooManyAttempts)
            } else if (ctx.error.code?.includes('account locked')) {
              errorMessage.push(loginErrors.accountLocked)
            } else if (ctx.error.code?.includes('network')) {
              errorMessage.push(loginErrors.networkError)
            } else if (ctx.error.message?.includes('rate limit')) {
              errorMessage.push(loginErrors.rateLimit)
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
          const errorMessage = result?.error?.message || loginErrors.loginFailed
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
        message: resetMessages.enterEmail,
      })
      return
    }

    const emailValidation = quickValidateEmail(forgotPasswordEmail.trim().toLowerCase())
    if (!emailValidation.isValid) {
      setResetStatus({
        type: 'error',
        message: resetMessages.invalidEmail,
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
        let errorMessage = resetMessages.failed

        if (
          errorData.message?.includes('Invalid body parameters') ||
          errorData.message?.includes('invalid email')
        ) {
          errorMessage = resetMessages.invalidEmail
        } else if (errorData.message?.includes('Email is required')) {
          errorMessage = resetMessages.enterEmail
        } else if (
          errorData.message?.includes('user not found') ||
          errorData.message?.includes('User not found')
        ) {
          errorMessage = resetMessages.noAccountFound
        }

        throw new Error(errorMessage)
      }

      setResetStatus({
        type: 'success',
        message: resetMessages.success,
      })

      setTimeout(() => {
        setForgotPasswordOpen(false)
        setResetStatus({ type: null, message: '' })
      }, 2000)
    } catch (error) {
      logger.error('Error requesting password reset:', { error })
      setResetStatus({
        type: 'error',
        message: error instanceof Error ? error.message : resetMessages.failed,
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
        <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
          {t('sign_in.page_title')}
        </h1>
        <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
          {t('sign_in.page_sub_title')}
        </p>
      </div>

      {/* SSO Login Button (primary top-only when it is the only method) */}
      {showTopSSO && (
        <div className={`${inter.className} mt-8`}>
          <SSOLoginButton
            callbackURL={callbackUrl}
            variant='primary'
            primaryClassName={buttonClass}
          />
        </div>
      )}

      {/* Password reset success message */}
      {resetSuccessMessage && (
        <div className={`${inter.className} mt-1 space-y-1 text-[#4CAF50] text-xs`}>
          <p>{resetSuccessMessage}</p>
        </div>
      )}

      {/* Email/Password Form - show unless explicitly disabled */}
      {!isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED')) && (
        <form onSubmit={onSubmit} className={`${inter.className} mt-8 space-y-8`}>
          <div className='space-y-6'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='email'>{t('sign_in.labels.email')}</Label>
              </div>
              <Input
                id='email'
                name='email'
                placeholder={t('sign_in.placeholders.email')}
                required
                autoCapitalize='none'
                autoComplete='email'
                autoCorrect='off'
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
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='password'>{t('sign_in.labels.password')}</Label>
                <button
                  type='button'
                  onClick={() => setForgotPasswordOpen(true)}
                  className='font-medium text-muted-foreground text-xs transition hover:text-foreground'
                >
                  {t('sign_in.links.forgot_password')}
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
                  placeholder={t('sign_in.placeholders.password')}
                  value={password}
                  onChange={handlePasswordChange}
                  className={cn(
                    'rounded-[10px] pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                    showValidationError &&
                      passwordErrors.length > 0 &&
                      'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                  )}
                />
                <button
                  type='button'
                  onClick={() => setShowPassword(!showPassword)}
                  className='-translate-y-1/2 absolute top-1/2 right-3 text-gray-500 transition hover:text-gray-700'
                  aria-label={
                    showPassword ? t('sign_in.aria.hide_password') : t('sign_in.aria.show_password')
                  }
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

          <BrandedButton
            type='submit'
            disabled={isLoading}
            loading={isLoading}
            loadingText={t('sign_in.buttons.signing_in')}
          >
            {t('sign_in.buttons.sign_in')}
          </BrandedButton>
        </form>
      )}

      {/* Divider - show when we have multiple auth methods */}
      {showDivider && (
        <div className={`${inter.className} relative my-6 font-light`}>
          <div className='absolute inset-0 flex items-center'>
            <div className='auth-divider w-full border-t' />
          </div>
          <div className='relative flex justify-center text-sm'>
            <span className='bg-white px-4 font-[340] text-muted-foreground'>
              {t('sign_in.divider_label')}
            </span>
          </div>
        </div>
      )}

      {showBottomSection && (
        <div className={cn(inter.className, !emailEnabled ? 'mt-8' : undefined)}>
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
        <div className={`${inter.className} pt-6 text-center font-light text-[14px]`}>
          <span className='font-normal'>{t('sign_in.links.no_account')} </span>
          <Link
            href={isInviteFlow ? `/signup?invite_flow=true&callbackUrl=${callbackUrl}` : '/signup'}
            className='font-medium text-[var(--brand-accent-hex)] underline-offset-4 transition hover:text-[var(--brand-accent-hover-hex)] hover:underline'
          >
            {t('sign_in.links.sign_up')}
          </Link>
        </div>
      )}

      <div
        className={`${inter.className} auth-text-muted absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[13px] leading-relaxed sm:px-8 md:px-[44px]`}
      >
        {t.rich('sign_in.agreement', {
          terms: (chunks) => (
            <Link
              href='/terms'
              target='_blank'
              rel='noopener noreferrer'
              className='auth-link underline-offset-4 transition hover:underline'
            >
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link
              href='/privacy'
              target='_blank'
              rel='noopener noreferrer'
              className='auth-link underline-offset-4 transition hover:underline'
            >
              {chunks}
            </Link>
          ),
        })}
      </div>

      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent className='auth-card auth-card-shadow max-w-[540px] rounded-[10px] border backdrop-blur-sm'>
          <DialogHeader>
            <DialogTitle className='font-semibold text-black text-xl tracking-tight'>
              {t('sign_in.reset_password.title')}
            </DialogTitle>
            <DialogDescription className='text-muted-foreground text-sm'>
              {t('sign_in.reset_password.description')}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='reset-email'>{t('sign_in.labels.email')}</Label>
              </div>
              <Input
                id='reset-email'
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                placeholder={t('sign_in.placeholders.email')}
                required
                type='email'
                className={cn(
                  'rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                  resetStatus.type === 'error' &&
                    'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                )}
              />
              {resetStatus.type === 'error' && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  <p>{resetStatus.message}</p>
                </div>
              )}
            </div>
            {resetStatus.type === 'success' && (
              <div className='mt-1 space-y-1 text-[#4CAF50] text-xs'>
                <p>{resetStatus.message}</p>
              </div>
            )}
            <BrandedButton
              type='button'
              onClick={handleForgotPassword}
              disabled={isSubmittingReset}
              loading={isSubmittingReset}
              loadingText={t('sign_in.reset_password.sending')}
            >
              {t('sign_in.reset_password.send_reset_link')}
            </BrandedButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
