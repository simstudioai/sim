'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  const [isLoading, setIsLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { addNotification } = useNotificationStore()

  // Forgot password states
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [isSubmittingReset, setIsSubmittingReset] = useState(false)
  const [resetStatus, setResetStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

  useEffect(() => {
    setMounted(true)
  }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    try {
      const result = await client.signIn.email({
        email,
        password,
        callbackURL: '/w',
      })

      if (!result || result.error) {
        throw new Error(result?.error?.message || 'Authentication failed')
      }
    } catch (err: any) {
      let errorMessage = 'Invalid email or password'

      if (err.message?.includes('not verified')) {
        // Redirect to verification page directly without asking for confirmation
        try {
          // Send a new verification OTP
          await client.emailOtp.sendVerificationOtp({
            email,
            type: 'email-verification',
          })

          // Redirect to the verify page
          router.push(`/verify?email=${encodeURIComponent(email)}`)
          return
        } catch (verifyErr) {
          errorMessage = 'Failed to send verification code. Please try again later.'
        }
      } else if (err.message?.includes('not found')) {
        errorMessage = 'No account found with this email. Please sign up first.'
      } else if (err.message?.includes('invalid password')) {
        errorMessage = 'Invalid password. Please try again or use the forgot password link.'
      } else if (err.message?.includes('too many attempts')) {
        errorMessage = 'Too many login attempts. Please try again later or reset your password.'
      } else if (err.message?.includes('account locked')) {
        errorMessage = 'Your account has been locked for security. Please reset your password.'
      } else if (err.message?.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.'
      } else if (err.message?.includes('rate limit')) {
        errorMessage = 'Too many requests. Please wait a moment before trying again.'
      }

      addNotification('error', errorMessage, null)
      // Prevent navigation on error
      return
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
      {mounted && <NotificationList />}
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">Sim Studio</h1>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Enter your credentials to access your account</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              <SocialLoginButtons
                githubAvailable={githubAvailable}
                googleAvailable={googleAvailable}
                callbackURL="/w"
                isProduction={isProduction}
              />
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
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      placeholder="Enter your password"
                      required
                    />
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
              <Link href="/signup" className="text-primary hover:underline">
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
