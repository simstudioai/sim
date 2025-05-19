'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Command, CornerDownLeft, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { useNotificationStore } from '@/stores/notifications/store'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'

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
    const errors = validatePassword(newPassword)
    setPasswordErrors(errors)
    setShowValidationError(false)
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
            } else if (ctx.error.message?.includes('MISSING_CREDENTIALS')) {
              errorMessage = 'Please enter all required fields.'
            } else if (ctx.error.message?.includes('EMAIL_PASSWORD_DISABLED')) {
              errorMessage = 'Email and password signup is disabled.'
            } else if (ctx.error.message?.includes('FAILED_TO_CREATE_USER')) {
              errorMessage = 'Failed to create account. Please try again later.'
            } else if (ctx.error.message?.includes('network')) {
              errorMessage = 'Network error. Please check your connection and try again.'
            } else if (ctx.error.message?.includes('rate limit')) {
              errorMessage = 'Too many requests. Please wait a moment before trying again.'
            }

            addNotification('error', errorMessage, null)
          },
        }
      )

      if (!response || response.error) {
        setIsLoading(false)
        return
      }

      // If we have a waitlist token, mark it as used
      if (waitlistToken) {
        try {
          await fetch('/api/waitlist', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              token: waitlistToken,
              email: emailValue,
              action: 'use',
            }),
          })
        } catch (error) {
          console.error('Error marking waitlist token as used:', error)
          // Continue regardless - this is not critical
        }
      }

      // Handle invitation flow redirect
      if (isInviteFlow && redirectUrl) {
        router.push(redirectUrl)
        return
      }

      // Send verification OTP in Prod
      try {
        await client.emailOtp.sendVerificationOtp({
          email: emailValue,
          type: 'email-verification',
        })

        if (typeof window !== 'undefined') {
          sessionStorage.setItem('verificationEmail', emailValue)
          localStorage.setItem('has_logged_in_before', 'true')
          document.cookie = 'has_logged_in_before=true; path=/; max-age=31536000; SameSite=Lax' // 1 year expiry
        }

        router.push('/verify')
      } catch (error) {
        console.error('Failed to send verification code:', error)
        addNotification('error', 'Account created but failed to send verification code.', null)
        router.push('/login')
      }
    } catch (error) {
      console.error('Signup error:', error)
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-[32px] font-semibold tracking-tight text-white">Create Account</h1>
        <p className="text-sm text-neutral-400">Enter your details to create a new account</p>
      </div>

      <div className="flex flex-col gap-6">
        <div className="bg-neutral-800/50 backdrop-blur-sm border border-neutral-700/40 rounded-xl p-6">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-neutral-300">
                  Full Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="Enter your name"
                  required
                  type="text"
                  autoCapitalize="words"
                  autoComplete="name"
                  className="bg-neutral-900 border-neutral-700 text-white"
                />
              </div>
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-neutral-900 border-neutral-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-neutral-300">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    required
                    type={showPassword ? 'text' : 'password'}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    placeholder="Enter your password"
                    autoCorrect="off"
                    value={password}
                    onChange={handlePasswordChange}
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
                {showValidationError && passwordErrors.length > 0 && (
                  <div className="text-xs text-red-400 mt-1 space-y-1">
                    {passwordErrors.map((error, index) => (
                      <p key={index}>{error}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-[#701ffc] hover:bg-[#802FFF] h-11 font-medium text-base text-white shadow-lg shadow-[#701ffc]/20 transition-colors duration-200 flex items-center justify-center gap-2"
              disabled={isLoading}
            >
              {isLoading ? 'Creating account...' : 'Create Account'}
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
            githubAvailable={githubAvailable}
            googleAvailable={googleAvailable}
            callbackURL={redirectUrl || '/w'}
            isProduction={isProduction}
          />
        </div>

        <div className="text-center text-sm">
          <span className="text-neutral-400">Already have an account? </span>
          <Link
            href={isInviteFlow ? `/login?invite_flow=true&callbackUrl=${redirectUrl}` : '/login'}
            className="text-[#9D54FF] hover:text-[#a66fff] font-medium transition underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
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
      fallback={<div className="h-screen flex items-center justify-center">Loading...</div>}
    >
      <SignupFormContent
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        isProduction={isProduction}
      />
    </Suspense>
  )
}
