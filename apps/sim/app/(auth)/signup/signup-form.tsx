'use client'

import { Suspense, useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
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
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
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

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
    // Clear any previous email errors when the user starts typing
    if (emailError) {
      setEmailError('')
    }
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
        setPasswordErrors([errors[0]])
        setShowValidationError(true)
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
            const errorMessage: string[] = ['Failed to create account']

            if (ctx.error.code?.includes('USER_ALREADY_EXISTS')) {
              errorMessage.push(
                'An account with this email already exists. Please sign in instead.'
              )
              setEmailError(errorMessage[0])
            } else if (
              ctx.error.code?.includes('BAD_REQUEST') ||
              ctx.error.message?.includes('Email and password sign up is not enabled')
            ) {
              errorMessage.push('Email signup is currently disabled.')
              setEmailError(errorMessage[0])
            } else if (ctx.error.code?.includes('INVALID_EMAIL')) {
              errorMessage.push('Please enter a valid email address.')
              setEmailError(errorMessage[0])
            } else if (ctx.error.code?.includes('PASSWORD_TOO_SHORT')) {
              errorMessage.push('Password must be at least 8 characters long.')
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else if (ctx.error.code?.includes('PASSWORD_TOO_LONG')) {
              errorMessage.push('Password must be less than 128 characters long.')
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else if (ctx.error.code?.includes('network')) {
              errorMessage.push('Network error. Please check your connection and try again.')
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else if (ctx.error.code?.includes('rate limit')) {
              errorMessage.push('Too many requests. Please wait a moment before trying again.')
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            } else {
              setPasswordErrors(errorMessage)
              setShowValidationError(true)
            }
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

      try {
        await client.emailOtp.sendVerificationOtp({
          email: emailValue,
          type: 'email-verification',
        })
      } catch (err) {
        console.error('Failed to send verification OTP:', err)
      }

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('verificationEmail', emailValue)
        localStorage.setItem('has_logged_in_before', 'true')
        document.cookie = 'has_logged_in_before=true; path=/; max-age=31536000; SameSite=Lax' // 1 year expiry
      }

      router.push('/verify?fromSignup=true')
    } catch (error) {
      console.error('Signup error:', error)
      setIsLoading(false)
    }
  }

  return (
    <div className='space-y-6'>
      <div className='space-y-2 text-center'>
        <h1 className='font-semibold text-[32px] text-white tracking-tight'>Create Account</h1>
        <p className='text-neutral-400 text-sm'>Enter your details to create a new account</p>
      </div>

      <div className='flex flex-col gap-6'>
        <div className='rounded-xl border border-neutral-700/40 bg-neutral-800/50 p-6 backdrop-blur-sm'>
          <SocialLoginButtons
            githubAvailable={githubAvailable}
            googleAvailable={googleAvailable}
            callbackURL={redirectUrl || '/w'}
            isProduction={isProduction}
          />

          <div className='relative mt-2 py-4'>
            <div className='absolute inset-0 flex items-center'>
              <div className='w-full border-neutral-700/50 border-t' />
            </div>
          </div>

          <form onSubmit={onSubmit} className='space-y-5'>
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='name' className='text-neutral-300'>
                  Full Name
                </Label>
                <Input
                  id='name'
                  name='name'
                  placeholder='Enter your name'
                  required
                  type='text'
                  autoCapitalize='words'
                  autoComplete='name'
                  className='border-neutral-700 bg-neutral-900 text-white placeholder:text-white/60'
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='email' className='text-neutral-300'>
                  Email
                </Label>
                <Input
                  id='email'
                  name='email'
                  placeholder='Enter your email'
                  required
                  type='email'
                  autoCapitalize='none'
                  autoComplete='email'
                  autoCorrect='off'
                  value={email}
                  onChange={handleEmailChange}
                  className={cn(
                    'border-neutral-700 bg-neutral-900 text-white placeholder:text-white/60',
                    emailError && 'border-red-500 focus-visible:ring-red-500'
                  )}
                />
                {emailError && (
                  <div className='mt-1 text-red-400 text-xs'>
                    <p>{emailError}</p>
                  </div>
                )}
              </div>
              <div className='space-y-2'>
                <Label htmlFor='password' className='text-neutral-300'>
                  Password
                </Label>
                <div className='relative'>
                  <Input
                    id='password'
                    name='password'
                    required
                    type={showPassword ? 'text' : 'password'}
                    autoCapitalize='none'
                    autoComplete='new-password'
                    placeholder='Enter your password'
                    autoCorrect='off'
                    value={password}
                    onChange={handlePasswordChange}
                    className='border-neutral-700 bg-neutral-900 pr-10 text-white placeholder:text-white/60'
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
              {isLoading ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>
        </div>

        <div className='text-center text-sm'>
          <span className='text-neutral-400'>Already have an account? </span>
          <Link
            href={isInviteFlow ? `/login?invite_flow=true&callbackUrl=${redirectUrl}` : '/login'}
            className='font-medium text-[#9D54FF] underline-offset-4 transition hover:text-[#a66fff] hover:underline'
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
      fallback={<div className='flex h-screen items-center justify-center'>Loading...</div>}
    >
      <SignupFormContent
        githubAvailable={githubAvailable}
        googleAvailable={googleAvailable}
        isProduction={isProduction}
      />
    </Suspense>
  )
}
