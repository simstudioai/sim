'use client'

import { Suspense, useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client, useSession } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'

const logger = createLogger('SignupForm')

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

const NAME_VALIDATIONS = {
  required: {
    test: (value: string) => Boolean(value && typeof value === 'string'),
    message: 'Name is required.',
  },
  notEmpty: {
    test: (value: string) => value.trim().length > 0,
    message: 'Name cannot be empty.',
  },
  validCharacters: {
    regex: /^[\p{L}\s\-']+$/u,
    message: 'Name can only contain letters, spaces, hyphens, and apostrophes.',
  },
  noConsecutiveSpaces: {
    regex: /^(?!.*\s\s).*$/,
    message: 'Name cannot contain consecutive spaces.',
  },
  noLeadingTrailingSpaces: {
    test: (value: string) => value === value.trim(),
    message: 'Name cannot start or end with spaces.',
  },
}

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
  const { refetch: refetchSession } = useSession()
  const [isLoading, setIsLoading] = useState(false)
  const [, setMounted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [redirectUrl, setRedirectUrl] = useState('')
  const [isInviteFlow, setIsInviteFlow] = useState(false)

  // Name validation state
  const [name, setName] = useState('')
  const [nameErrors, setNameErrors] = useState<string[]>([])
  const [showNameValidationError, setShowNameValidationError] = useState(false)

  useEffect(() => {
    setMounted(true)
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(emailParam)
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

  // Validate password and return array of error messages
  const validatePassword = (passwordValue: string): string[] => {
    const errors: string[] = []

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

  // Validate name and return array of error messages
  const validateName = (nameValue: string): string[] => {
    const errors: string[] = []

    if (!NAME_VALIDATIONS.required.test(nameValue)) {
      errors.push(NAME_VALIDATIONS.required.message)
      return errors // Return early for required field
    }

    if (!NAME_VALIDATIONS.notEmpty.test(nameValue)) {
      errors.push(NAME_VALIDATIONS.notEmpty.message)
      return errors // Return early for empty field
    }

    if (!NAME_VALIDATIONS.validCharacters.regex.test(nameValue.trim())) {
      errors.push(NAME_VALIDATIONS.validCharacters.message)
    }

    if (!NAME_VALIDATIONS.noConsecutiveSpaces.regex.test(nameValue)) {
      errors.push(NAME_VALIDATIONS.noConsecutiveSpaces.message)
    }

    if (!NAME_VALIDATIONS.noLeadingTrailingSpaces.test(nameValue)) {
      errors.push(NAME_VALIDATIONS.noLeadingTrailingSpaces.message)
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

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)

    // Silently validate but don't show errors until submit
    const errors = validateName(newName)
    setNameErrors(errors)
    setShowNameValidationError(false)
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    // Silently validate but don't show errors until submit
    const errors = validateEmailField(newEmail)
    setEmailErrors(errors)
    setShowEmailValidationError(false)

    // Clear any previous server-side email errors when the user starts typing
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

    // Validate name on submit
    const nameValidationErrors = validateName(name)
    setNameErrors(nameValidationErrors)
    setShowNameValidationError(nameValidationErrors.length > 0)

    // Validate email on submit
    const emailValidationErrors = validateEmailField(emailValue)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    // Validate password on submit
    const errors = validatePassword(passwordValue)
    setPasswordErrors(errors)

    // Only show validation errors if there are any
    setShowValidationError(errors.length > 0)

    try {
      if (
        nameValidationErrors.length > 0 ||
        emailValidationErrors.length > 0 ||
        errors.length > 0
      ) {
        // Prioritize name errors first, then email errors, then password errors
        if (nameValidationErrors.length > 0) {
          setNameErrors([nameValidationErrors[0]])
          setShowNameValidationError(true)
        }
        if (emailValidationErrors.length > 0) {
          setEmailErrors([emailValidationErrors[0]])
          setShowEmailValidationError(true)
        }
        if (errors.length > 0) {
          setPasswordErrors([errors[0]])
          setShowValidationError(true)
        }
        setIsLoading(false)
        return
      }

      // Check if name will be truncated and warn user
      const trimmedName = name.trim()
      if (trimmedName.length > 100) {
        setNameErrors(['Name will be truncated to 100 characters. Please shorten your name.'])
        setShowNameValidationError(true)
        setIsLoading(false)
        return
      }

      const sanitizedName = trimmedName

      const response = await client.signUp.email(
        {
          email: emailValue,
          password: passwordValue,
          name: sanitizedName,
        },
        {
          onError: (ctx) => {
            logger.error('Signup error:', ctx.error)
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

      // Refresh session to get the new user data immediately after signup
      try {
        await refetchSession()
        logger.info('Session refreshed after successful signup')
      } catch (sessionError) {
        logger.error('Failed to refresh session after signup:', sessionError)
        // Continue anyway - the verification flow will handle this
      }

      // For new signups, always require verification
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('verificationEmail', emailValue)
        localStorage.setItem('has_logged_in_before', 'true')

        // Set cookie flag for middleware check
        document.cookie = 'requiresEmailVerification=true; path=/; max-age=900; SameSite=Lax' // 15 min expiry
        document.cookie = 'has_logged_in_before=true; path=/; max-age=31536000; SameSite=Lax'

        // Store invitation flow state if applicable
        if (isInviteFlow && redirectUrl) {
          sessionStorage.setItem('inviteRedirectUrl', redirectUrl)
          sessionStorage.setItem('isInviteFlow', 'true')
        }
      }

      // Send verification OTP manually
      try {
        await client.emailOtp.sendVerificationOtp({
          email: emailValue,
          type: 'email-verification',
        })
      } catch (otpError) {
        logger.error('Failed to send OTP:', otpError)
        // Continue anyway - user can use resend button
      }

      // Always redirect to verification for new signups
      router.push('/verify?fromSignup=true')
    } catch (error) {
      logger.error('Signup error:', error)
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
            callbackURL={redirectUrl || '/workspace'}
            isProduction={isProduction}
          />

          {(githubAvailable || googleAvailable) && (
            <div className='relative mt-2 py-4'>
              <div className='absolute inset-0 flex items-center'>
                <div className='w-full border-neutral-700/50 border-t' />
              </div>
            </div>
          )}

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
                  type='text'
                  autoCapitalize='words'
                  autoComplete='name'
                  title='Name can only contain letters, spaces, hyphens, and apostrophes'
                  value={name}
                  onChange={handleNameChange}
                  className={cn(
                    'border-neutral-700 bg-neutral-900 text-white placeholder:text-white/60',
                    showNameValidationError &&
                      nameErrors.length > 0 &&
                      'border-red-500 focus-visible:ring-red-500'
                  )}
                />
                {showNameValidationError && nameErrors.length > 0 && (
                  <div className='mt-1 space-y-1 text-red-400 text-xs'>
                    {nameErrors.map((error, index) => (
                      <p key={index}>{error}</p>
                    ))}
                  </div>
                )}
              </div>
              <div className='space-y-2'>
                <Label htmlFor='email' className='text-neutral-300'>
                  Email
                </Label>
                <Input
                  id='email'
                  name='email'
                  placeholder='Enter your email'
                  autoCapitalize='none'
                  autoComplete='email'
                  autoCorrect='off'
                  value={email}
                  onChange={handleEmailChange}
                  className={cn(
                    'border-neutral-700 bg-neutral-900 text-white placeholder:text-white/60',
                    (emailError || (showEmailValidationError && emailErrors.length > 0)) &&
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
                {emailError && !showEmailValidationError && (
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
              className='flex h-11 w-full items-center justify-center gap-2 bg-[var(--brand-primary-hex)] font-medium text-base text-white shadow-[var(--brand-primary-hex)]/20 shadow-lg transition-colors duration-200 hover:bg-[var(--brand-primary-hover-hex)]'
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
            className='font-medium text-[var(--brand-accent-hex)] underline-offset-4 transition hover:text-[var(--brand-accent-hover-hex)] hover:underline'
          >
            Sign in
          </Link>
        </div>

        <div className='text-center text-neutral-500/80 text-xs leading-relaxed'>
          By creating an account, you agree to our{' '}
          <Link
            href='/terms'
            className='text-neutral-400 underline-offset-4 transition hover:text-neutral-300 hover:underline'
          >
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link
            href='/privacy'
            className='text-neutral-400 underline-offset-4 transition hover:text-neutral-300 hover:underline'
          >
            Privacy Policy
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
