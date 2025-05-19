'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useNotificationStore } from '@/stores/notifications/store'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'

const logger = createLogger('LoginForm')

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
  const [mounted, setMounted] = useState(false)
  const { addNotification } = useNotificationStore()
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')

  // Initialize state for URL parameters
  const [callbackUrl, setCallbackUrl] = useState('/w')
  const [isInviteFlow, setIsInviteFlow] = useState(false)

  // Forgot password states
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [isSubmittingReset, setIsSubmittingReset] = useState(false)
  const [resetStatus, setResetStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

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
          // Keep the default safe value ('/w')
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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string

    try {
      // Final validation before submission
      const safeCallbackUrl = validateCallbackUrl(callbackUrl) ? callbackUrl : '/w'

      const result = await client.signIn.email(
        {
          email,
          password,
          callbackURL: safeCallbackUrl,
        },
        {
          onError: (ctx) => {
            console.error('Login error:', ctx.error)
            let errorMessage = 'Invalid email or password'

            // Handle all possible error cases from Better Auth
            if (ctx.error.message?.includes('EMAIL_NOT_VERIFIED')) {
              return
            } else if (
              ctx.error.message?.includes('BAD_REQUEST') ||
              ctx.error.message?.includes('Email and password sign in is not enabled')
            ) {
              errorMessage = 'Email sign in is currently disabled.'
            } else if (
              ctx.error.message?.includes('INVALID_CREDENTIALS') ||
              ctx.error.message?.includes('invalid password')
            ) {
              errorMessage = 'Invalid email or password. Please try again.'
            } else if (
              ctx.error.message?.includes('USER_NOT_FOUND') ||
              ctx.error.message?.includes('not found')
            ) {
              errorMessage = 'No account found with this email. Please sign up first.'
            } else if (ctx.error.message?.includes('MISSING_CREDENTIALS')) {
              errorMessage = 'Please enter both email and password.'
            } else if (ctx.error.message?.includes('EMAIL_PASSWORD_DISABLED')) {
              errorMessage = 'Email and password login is disabled.'
            } else if (ctx.error.message?.includes('FAILED_TO_CREATE_SESSION')) {
              errorMessage = 'Failed to create session. Please try again later.'
            } else if (ctx.error.message?.includes('too many attempts')) {
              errorMessage =
                'Too many login attempts. Please try again later or reset your password.'
            } else if (ctx.error.message?.includes('account locked')) {
              errorMessage =
                'Your account has been locked for security. Please reset your password.'
            } else if (ctx.error.message?.includes('network')) {
              errorMessage = 'Network error. Please check your connection and try again.'
            } else if (ctx.error.message?.includes('rate limit')) {
              errorMessage = 'Too many requests. Please wait a moment before trying again.'
            }

            addNotification('error', errorMessage, null)
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
      if (err.message?.includes('not verified') || err.message?.includes('EMAIL_NOT_VERIFIED')) {
        try {
          await client.emailOtp.sendVerificationOtp({
            email,
            type: 'email-verification',
          })

          if (typeof window !== 'undefined') {
            sessionStorage.setItem('verificationEmail', email)
          }

          router.push(`/verify`)
          return
        } catch (verifyErr) {
          addNotification(
            'error',
            'Failed to send verification code. Please try again later.',
            null
          )
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
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-[32px] font-semibold tracking-tight text-white">Sign In</h1>
        <p className="text-sm text-neutral-400">
          Enter your email below to sign in to your account
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <div className="bg-neutral-800/50 backdrop-blur-sm border border-neutral-700/40 rounded-xl p-6">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-neutral-300">
                  Email
                </Label>
                <Input
                  id="email"
                  name="email"
                  placeholder="Enter your email"
                  required
                  type="email"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect="off"
                  className="bg-neutral-900 border-neutral-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-neutral-300">
                    Password
                  </Label>
                  <button
                    type="button"
                    onClick={() => setForgotPasswordOpen(true)}
                    className="text-xs text-neutral-400 hover:text-white transition font-medium"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    required
                    type={showPassword ? 'text' : 'password'}
                    autoCapitalize="none"
                    autoComplete="current-password"
                    autoCorrect="off"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-neutral-900 border-neutral-700 text-white pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white transition"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-[#701ffc] hover:bg-[#802FFF] h-11 font-medium text-base text-white shadow-lg shadow-[#701ffc]/20 transition-colors duration-200 flex items-center justify-center gap-2"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-700/50"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-neutral-800/50 px-2 text-neutral-400">or continue with</span>
            </div>
          </div>

          <SocialLoginButtons
            googleAvailable={googleAvailable}
            githubAvailable={githubAvailable}
            isProduction={isProduction}
            callbackURL={callbackUrl}
          />
        </div>

        <div className="text-center text-sm">
          <span className="text-neutral-400">Don't have an account? </span>
          <Link
            href={isInviteFlow ? `/signup?invite_flow=true&callbackUrl=${callbackUrl}` : '/signup'}
            className="text-[#9D54FF] hover:text-[#a66fff] font-medium transition underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </div>
      </div>

      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent className="bg-neutral-800/90 border border-neutral-700/50 text-white backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold tracking-tight text-white">
              Reset Password
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-neutral-300">
              Enter your email address and we'll send you a link to reset your password.
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-email" className="text-neutral-300">
                Email
              </Label>
              <Input
                id="reset-email"
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                placeholder="Enter your email"
                required
                type="email"
                className="bg-neutral-900 border-neutral-700/80 text-white focus:border-[#802FFF]/70 focus:ring-[#802FFF]/20"
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
              type="button"
              onClick={handleForgotPassword}
              className="w-full bg-[#701ffc] hover:bg-[#802FFF] h-11 font-medium text-base text-white shadow-lg shadow-[#701ffc]/20 transition-colors duration-200"
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
