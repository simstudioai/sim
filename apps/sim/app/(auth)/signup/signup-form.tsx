'use client'

import { Suspense, useEffect, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { useNotificationStore } from '@/stores/notifications/store'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { NotificationList } from '@/app/w/[id]/components/notifications/notifications'

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
  const [isLoading, setIsLoading] = useState(false)
  const [, setMounted] = useState(false)
  const { addNotification } = useNotificationStore()
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const [email, setEmail] = useState('')
  const [waitlistToken, setWaitlistToken] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [isInviteFlow, setIsInviteFlow] = useState(false)

  useEffect(() => {
    setMounted(true)
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(emailParam)
    }

    // Check for waitlist token
    const tokenParam = searchParams.get('token')
    if (tokenParam) {
      setWaitlistToken(tokenParam)
      // Verify the token and get the email
      verifyWaitlistToken(tokenParam)
    }

    // Handle redirection for invitation flow
    const redirectParam = searchParams.get('redirect')
    if (redirectParam) {
      setRedirectUrl(redirectParam)

      // Check if this is part of an invitation flow
      if (redirectParam.startsWith('/invite/')) {
        setIsInviteFlow(true)
      }
    }

    // Explicitly check for invite_flow parameter
    const inviteFlowParam = searchParams.get('invite_flow')
    if (inviteFlowParam === 'true') {
      setIsInviteFlow(true)
    }
  }, [searchParams])

  // Verify waitlist token and pre-fill email
  const verifyWaitlistToken = async (token: string) => {
    try {
      const response = await fetch('/api/auth/verify-waitlist-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      })

      const data = await response.json()

      if (data.success && data.email) {
        setEmail(data.email)
      }
    } catch (error) {
      console.error('Error verifying waitlist token:', error)
      // Continue regardless of errors - we don't want to block sign up
    }
  }

  // Validate password and return array of error messages
  const validatePassword = (passwordValue: string): string[] => {
    const errors: string[] = []

    // Check each validation criteria
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

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)

    // Silently validate but don't show errors
    validatePassword(newPassword)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const emailValue = formData.get('email') as string
    const passwordValue = formData.get('password') as string
    const name = formData.get('name') as string

    // Validate password on submit
    const errors = validatePassword(passwordValue)
    setPasswordErrors(errors)

    // Only show validation errors if there are any
    setShowValidationError(errors.length > 0)

    try {
      if (errors.length > 0) {
        // Show first error as notification
        addNotification('error', errors[0], null)
        setIsLoading(false)
        return
      }

      const response = await client.signUp.email(
        {
          email: emailValue,
          password: passwordValue,
          name,
        },
        {
          onError: (ctx) => {
            console.error('Signup error:', ctx.error)
            let errorMessage = 'Failed to create account'

            // Handle all possible error cases from Better Auth
            if (ctx.error.status === 422 || ctx.error.message?.includes('already exists')) {
              errorMessage = 'An account with this email already exists. Please sign in instead.'
            } else if (
              ctx.error.message?.includes('BAD_REQUEST') ||
              ctx.error.message?.includes('Email and password sign up is not enabled')
            ) {
              errorMessage = 'Email signup is currently disabled.'
            } else if (ctx.error.message?.includes('INVALID_EMAIL')) {
              errorMessage = 'Please enter a valid email address.'
            } else if (ctx.error.message?.includes('PASSWORD_TOO_SHORT')) {
              errorMessage = 'Password must be at least 8 characters long.'
            } else if (ctx.error.message?.includes('PASSWORD_TOO_LONG')) {
              errorMessage = 'Password must be less than 128 characters.'
            } else if (ctx.error.message?.includes('USER_ALREADY_EXISTS')) {
              errorMessage = 'An account with this email already exists. Please sign in instead.'
            } else if (ctx.error.message?.includes('FAILED_TO_CREATE_USER')) {
              errorMessage = 'Failed to create account. Please try again later.'
            } else if (ctx.error.message?.includes('FAILED_TO_CREATE_SESSION')) {
              errorMessage = 'Failed to create session. Please try again later.'
            } else if (ctx.error.message?.includes('rate limit')) {
              errorMessage = 'Too many signup attempts. Please try again later.'
            } else if (ctx.error.message?.includes('network')) {
              errorMessage = 'Network error. Please check your connection and try again.'
            } else if (ctx.error.message?.includes('invalid name')) {
              errorMessage = 'Please enter a valid name.'
            }

            addNotification('error', errorMessage, null)
          },
        }
      )

      if (!response || response.error) {
        setIsLoading(false)
        return
      }

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('verificationEmail', emailValue)

        // If this is an invitation flow, store that information for after verification
        if (isInviteFlow && redirectUrl) {
          sessionStorage.setItem('inviteRedirectUrl', redirectUrl)
          sessionStorage.setItem('isInviteFlow', 'true')
        }
      }

      // If verification is required, go to verify page with proper redirect
      if (isInviteFlow && redirectUrl) {
        router.push(
          `/verify?fromSignup=true&redirectAfter=${encodeURIComponent(redirectUrl)}&invite_flow=true`
        )
      } else {
        router.push(`/verify?fromSignup=true`)
      }
    } catch (err: any) {
      console.error('Uncaught signup error:', err)
    } finally {
      setIsLoading(false)
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
            <CardTitle>Create an account</CardTitle>
            <CardDescription>Enter your details to get started</CardDescription>
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
                    <Label htmlFor="name">Full Name</Label>
                    <Input id="name" name="name" type="text" placeholder="Alan Turing" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="name@example.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="Enter your password"
                        value={password}
                        onChange={handlePasswordChange}
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
                    {showValidationError && passwordErrors.length > 0 && (
                      <div className="text-sm text-red-500 mt-1">
                        <p>Password must:</p>
                        <ul className="list-disc pl-5 mt-1">
                          {passwordErrors.map((error, index) => (
                            <li key={index}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Creating account...' : 'Create account'}
                  </Button>
                </div>
              </form>
            </div>
          </CardContent>
          <CardFooter>
            <p className="text-sm text-gray-500 text-center w-full">
              Already have an account?{' '}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </main>
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
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <SignupFormContent
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        isProduction={isProduction}
      />
    </Suspense>
  )
}
