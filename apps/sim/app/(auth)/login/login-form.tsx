'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useNotificationStore } from '@/stores/notifications/store'
import { RequestResetForm } from '@/app/(auth)/components/reset-password-form'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { NotificationList } from '@/app/w/[id]/components/notifications/notifications'

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

    // Add other trusted domains if needed
    // const trustedDomains = ['trusted-domain.com']
    // if (trustedDomains.some(domain => url.startsWith(`https://${domain}`))) {
    //   return true
    // }

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      {/* Ensure NotificationList is always rendered */}
      <NotificationList />
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">Sim Studio</h1>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>
              {isInviteFlow
                ? 'Sign in to continue to the invitation'
                : 'Enter your credentials to access your account'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              {mounted && (
                <SocialLoginButtons
                  githubAvailable={githubAvailable}
                  googleAvailable={googleAvailable}
                  callbackURL={callbackUrl}
                  isProduction={isProduction}
                />
              )}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>
              <form onSubmit={onSubmit}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="name@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      <button
                        type="button"
                        onClick={() => {
                          const emailInput = document.getElementById('email') as HTMLInputElement
                          setForgotPasswordEmail(emailInput?.value || '')
                          setForgotPasswordOpen(true)
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Signing in...' : 'Sign in'}
                  </Button>
                </div>
              </form>
            </div>
          </CardContent>
          <CardFooter>
            <p className="text-sm text-gray-500 text-center w-full">
              Don't have an account?{' '}
              <Link
                href={mounted && searchParams ? `/signup?${searchParams.toString()}` : '/signup'}
                className="text-primary hover:underline"
              >
                Sign up
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <RequestResetForm
            email={forgotPasswordEmail}
            onEmailChange={setForgotPasswordEmail}
            onSubmit={handleForgotPassword}
            isSubmitting={isSubmittingReset}
            statusType={resetStatus.type}
            statusMessage={resetStatus.message}
            className="py-4"
          />
        </DialogContent>
      </Dialog>
    </main>
  )
}
