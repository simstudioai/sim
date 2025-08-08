'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'

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

// Validate callback URL to prevent open redirect vulnerabilities
const validateCallbackUrl = (url: string): boolean => {
  try {
    // If it's a relative URL, it's safe
    if (url.startsWith('/')) {
      return true
    }

    // If absolute URL, check if it belongs to the same origin
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

// Validate password and return array of error messages
const validatePassword = (passwordValue: string): string[] => {
  const errors: string[] = []

  if (!PASSWORD_VALIDATIONS.required.test(passwordValue)) {
    errors.push(PASSWORD_VALIDATIONS.required.message)
    return errors // Return early for required field
  }

  if (!PASSWORD_VALIDATIONS.notEmpty.test(passwordValue)) {
    errors.push(PASSWORD_VALIDATIONS.notEmpty.message)
    return errors // Return early for empty field
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
  const [_mounted, setMounted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)

  // Initialize state for URL parameters
  const [callbackUrl, setCallbackUrl] = useState('/workspace')
  const [isInviteFlow, setIsInviteFlow] = useState(false)

  // Forgot password states
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [isSubmittingReset, setIsSubmittingReset] = useState(false)
  const [resetStatus, setResetStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

  // Email validation state
  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)

  // Extract URL parameters after component mounts to avoid SSR issues
  useEffect(() => {
    setMounted(true)

    // Only access search params on the client side
    if (searchParams) {
      const callback = searchParams.get('callbackUrl')
      if (callback) {
        // Validate the callbackUrl before setting it
        if (validateCallbackUrl(callback)) {
          setCallbackUrl(callback)
        } else {
          logger.warn('Invalid callback URL detected and blocked:', { url: callback })
          // Keep the default safe value ('/workspace')
        }
      }

      const inviteFlow = searchParams.get('invite_flow') === 'true'
      setIsInviteFlow(inviteFlow)
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

    // Silently validate but don't show errors until submit
    const errors = validateEmailField(newEmail)
    setEmailErrors(errors)
    setShowEmailValidationError(false)
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)

    // Silently validate but don't show errors until submit
    const errors = validatePassword(newPassword)
    setPasswordErrors(errors)
    setShowValidationError(false)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string

    // Validate email on submit
    const emailValidationErrors = validateEmailField(email)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    // Validate password on submit
    const passwordValidationErrors = validatePassword(password)
    setPasswordErrors(passwordValidationErrors)
    setShowValidationError(passwordValidationErrors.length > 0)

    // If there are validation errors, stop submission
    if (emailValidationErrors.length > 0 || passwordValidationErrors.length > 0) {
      setIsLoading(false)
      return
    }

    try {
      // Final validation before submission
      const safeCallbackUrl = validateCallbackUrl(callbackUrl) ? callbackUrl : '/workspace'

      const result = await client.signIn.email(
        {
          email,
          password,
          callbackURL: safeCallbackUrl,
        },
        {
          onError: (ctx) => {
            console.error('Login error:', ctx.error)
            const errorMessage: string[] = ['Invalid email or password']

            if (ctx.error.code?.includes('EMAIL_NOT_VERIFIED')) {
              return
            }
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

            setPasswordErrors(errorMessage)
            setShowValidationError(true)
          },
        }
      )

      if (!result || result.error) {
        setIsLoading(false)
        return
      }

      // Mark that the user has previously logged in
      if (typeof window !== 'undefined') {
        localStorage.setItem('has_logged_in_before', 'true')
        document.cookie = 'has_logged_in_before=true; path=/; max-age=31536000; SameSite=Lax' // 1 year expiry
      }
    } catch (err: any) {
      // Handle only the special verification case that requires a redirect
      if (err.message?.includes('not verified') || err.code?.includes('EMAIL_NOT_VERIFIED')) {
        try {
          await client.emailOtp.sendVerificationOtp({
            email,
            type: 'email-verification',
          })

          if (typeof window !== 'undefined') {
            sessionStorage.setItem('verificationEmail', email)
          }

          router.push('/verify')
          return
        } catch (_verifyErr) {
          setPasswordErrors(['Failed to send verification code. Please try again later.'])
          setShowValidationError(true)
          setIsLoading(false)
          return
        }
      }

      console.error('Uncaught login error:', err)
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
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to request password reset')
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

  return (
    <div className='space-y-6'>
      <div className='space-y-2 text-center'>
        <h1 className='font-semibold text-[32px] text-white tracking-tight'>Sign In</h1>
        <p className='text-neutral-400 text-sm'>
          Enter your email below to sign in to your account
        </p>
      </div>

      <div className='flex flex-col gap-6'>
        <div className='rounded-xl border border-neutral-700/40 bg-neutral-800/50 p-6 backdrop-blur-sm'>
          <SocialLoginButtons
            googleAvailable={googleAvailable}
            githubAvailable={githubAvailable}
            isProduction={isProduction}
            callbackURL={callbackUrl}
          />

          <div className='relative mt-2 py-4'>
            <div className='absolute inset-0 flex items-center'>
              <div className='w-full border-neutral-700/50 border-t' />
            </div>
          </div>

          <form onSubmit={onSubmit} className='space-y-5'>
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='email' className='text-neutral-300'>
                  Email
                </Label>
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
                    'border-neutral-700 bg-neutral-900 text-white placeholder:text-white/60',
                    showEmailValidationError &&
                      emailErrors.length > 0 &&
                      'border-red-500 focus-visible:ring-red-500'
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
                  <Label htmlFor='password' className='text-neutral-300'>
                    Password
                  </Label>
                  <button
                    type='button'
                    onClick={() => setForgotPasswordOpen(true)}
                    className='font-medium text-neutral-400 text-xs transition hover:text-white'
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
                      'border-neutral-700 bg-neutral-900 pr-10 text-white placeholder:text-white/60',
                      showValidationError &&
                        passwordErrors.length > 0 &&
                        'border-red-500 focus-visible:ring-red-500'
                    )}
                  />
                  <button
                    type='button'
                    onClick={() => setShowPassword(!showPassword)}
                    className='-translate-y-1/2 absolute top-1/2 right-3 text-neutral-400 transition hover:text-white'
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

            <Button
              type='submit'
              className='flex h-11 w-full items-center justify-center gap-2 bg-[#701ffc] font-medium text-base text-white shadow-[#701ffc]/20 shadow-lg transition-colors duration-200 hover:bg-[#802FFF]'
              disabled={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </div>

        <div className='text-center text-sm'>
          <span className='text-neutral-400'>Don't have an account? </span>
          <Link
            href={isInviteFlow ? `/signup?invite_flow=true&callbackUrl=${callbackUrl}` : '/signup'}
            className='font-medium text-[#9D54FF] underline-offset-4 transition hover:text-[#a66fff] hover:underline'
          >
            Sign up
          </Link>
        </div>
      </div>

      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent className='border border-neutral-700/50 bg-neutral-800/90 text-white backdrop-blur-sm'>
          <DialogHeader>
            <DialogTitle className='font-semibold text-white text-xl tracking-tight'>
              Reset Password
            </DialogTitle>
            <DialogDescription className='text-neutral-300 text-sm'>
              Enter your email address and we'll send you a link to reset your password.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='reset-email' className='text-neutral-300'>
                Email
              </Label>
              <Input
                id='reset-email'
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                placeholder='Enter your email'
                required
                type='email'
                className='border-neutral-700/80 bg-neutral-900 text-white placeholder:text-white/60 focus:border-[#802FFF]/70 focus:ring-[#802FFF]/20'
              />
            </div>
            {resetStatus.type && (
              <div
                className={`text-sm ${
                  resetStatus.type === 'success' ? 'text-[#4CAF50]' : 'text-red-500'
                }`}
              >
                {resetStatus.message}
              </div>
            )}
            <Button
              type='button'
              onClick={handleForgotPassword}
              className='h-11 w-full bg-[#701ffc] font-medium text-base text-white shadow-[#701ffc]/20 shadow-lg transition-colors duration-200 hover:bg-[#802FFF]'
              disabled={isSubmittingReset}
            >
              {isSubmittingReset ? 'Sending...' : 'Send Reset Link'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
