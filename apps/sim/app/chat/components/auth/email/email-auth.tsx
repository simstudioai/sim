'use client'

import { type KeyboardEvent, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import Nav from '@/app/(landing)/components/nav/nav'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

const logger = createLogger('EmailAuth')

interface EmailAuthProps {
  subdomain: string
  onAuthSuccess: () => void
  title?: string
  primaryColor?: string
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

export default function EmailAuth({
  subdomain,
  onAuthSuccess,
  title = 'chat',
  primaryColor = 'var(--brand-primary-hover-hex)',
}: EmailAuthProps) {
  // Email auth state
  const [email, setEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [buttonClass, setButtonClass] = useState('auth-button-gradient')

  // OTP verification state
  const [showOtpVerification, setShowOtpVerification] = useState(false)
  const [otpValue, setOtpValue] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [isResendDisabled, setIsResendDisabled] = useState(false)

  useEffect(() => {
    // Check if CSS variable has been customized
    const checkCustomBrand = () => {
      const computedStyle = getComputedStyle(document.documentElement)
      const brandAccent = computedStyle.getPropertyValue('--brand-accent-hex').trim()

      // Check if the CSS variable exists and is different from the default
      if (brandAccent && brandAccent !== '#6f3dfa') {
        setButtonClass('auth-button-custom')
      } else {
        setButtonClass('auth-button-gradient')
      }
    }

    checkCustomBrand()

    // Also check on window resize or theme changes
    window.addEventListener('resize', checkCustomBrand)
    const observer = new MutationObserver(checkCustomBrand)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    return () => {
      window.removeEventListener('resize', checkCustomBrand)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
    if (countdown === 0 && isResendDisabled) {
      setIsResendDisabled(false)
    }
  }, [countdown, isResendDisabled])

  // Handle email input key down
  const handleEmailKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSendOtp()
    }
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    // Silently validate but don't show errors until submit
    const errors = validateEmailField(newEmail)
    setEmailErrors(errors)
    setShowEmailValidationError(false)
  }

  // Handle sending OTP
  const handleSendOtp = async () => {
    // Validate email on submit
    const emailValidationErrors = validateEmailField(email)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    // If there are validation errors, stop submission
    if (emailValidationErrors.length > 0) {
      return
    }

    setAuthError(null)
    setIsSendingOtp(true)

    try {
      const response = await fetch(`/api/chat/${subdomain}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setEmailErrors([errorData.error || 'Failed to send verification code'])
        setShowEmailValidationError(true)
        return
      }

      setShowOtpVerification(true)
    } catch (error) {
      logger.error('Error sending OTP:', error)
      setEmailErrors(['An error occurred while sending the verification code'])
      setShowEmailValidationError(true)
    } finally {
      setIsSendingOtp(false)
    }
  }

  const handleVerifyOtp = async (otp?: string) => {
    const codeToVerify = otp || otpValue

    if (!codeToVerify || codeToVerify.length !== 6) {
      return
    }

    setAuthError(null)
    setIsVerifyingOtp(true)

    try {
      const response = await fetch(`/api/chat/${subdomain}/otp`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email, otp: codeToVerify }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setAuthError(errorData.error || 'Invalid verification code')
        return
      }

      onAuthSuccess()
    } catch (error) {
      logger.error('Error verifying OTP:', error)
      setAuthError('An error occurred during verification')
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  const handleResendOtp = async () => {
    setAuthError(null)
    setIsSendingOtp(true)
    setIsResendDisabled(true)
    setCountdown(30)

    try {
      const response = await fetch(`/api/chat/${subdomain}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setAuthError(errorData.error || 'Failed to resend verification code')
        setIsResendDisabled(false)
        setCountdown(0)
        return
      }

      // Don't show success message in error state, just reset OTP
      setOtpValue('')
    } catch (error) {
      logger.error('Error resending OTP:', error)
      setAuthError('An error occurred while resending the verification code')
      setIsResendDisabled(false)
      setCountdown(0)
    } finally {
      setIsSendingOtp(false)
    }
  }

  return (
    <div className='bg-white'>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            {/* Header */}
            <div className='space-y-1 text-center'>
              <h1
                className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}
              >
                {showOtpVerification ? 'Verify Your Email' : 'Email Verification'}
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                {showOtpVerification
                  ? `A verification code has been sent to ${email}`
                  : 'This chat requires email verification'}
              </p>
            </div>

            {/* Form */}
            <div className={`${inter.className} mt-8 w-full`}>
              {!showOtpVerification ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleSendOtp()
                  }}
                  className='space-y-8'
                >
                  <div className='space-y-6'>
                    <div className='space-y-2'>
                      <div className='flex items-center justify-between'>
                        <Label htmlFor='email'>Email</Label>
                      </div>
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
                        onKeyDown={handleEmailKeyDown}
                        className={cn(
                          'rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showEmailValidationError &&
                            emailErrors.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                        autoFocus
                      />
                      {showEmailValidationError && emailErrors.length > 0 && (
                        <div className='mt-1 space-y-1 text-red-400 text-xs'>
                          {emailErrors.map((error, index) => (
                            <p key={index}>{error}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <Button
                    type='submit'
                    className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
                    disabled={isSendingOtp}
                  >
                    {isSendingOtp ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        Sending Code...
                      </>
                    ) : (
                      'Continue'
                    )}
                  </Button>
                </form>
              ) : (
                <div className='space-y-8'>
                  <div className='space-y-6'>
                    <p className='text-center text-muted-foreground text-sm'>
                      Enter the 6-digit code to verify your account. If you don't see it in your
                      inbox, check your spam folder.
                    </p>

                    <div className='flex justify-center'>
                      <InputOTP
                        maxLength={6}
                        value={otpValue}
                        onChange={(value) => {
                          setOtpValue(value)
                          if (value.length === 6) {
                            handleVerifyOtp(value)
                          }
                        }}
                        disabled={isVerifyingOtp}
                        className={cn('gap-2', authError && 'otp-error')}
                      >
                        <InputOTPGroup className='[&>div]:!rounded-[10px] gap-2'>
                          {[0, 1, 2, 3, 4, 5].map((index) => (
                            <InputOTPSlot
                              key={index}
                              index={index}
                              className={cn(
                                '!rounded-[10px] h-12 w-12 border bg-white text-center font-medium text-lg shadow-sm transition-all duration-200',
                                'border-gray-300 hover:border-gray-400',
                                'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                                authError &&
                                  'border-red-500 focus:border-red-500 focus:ring-red-100'
                              )}
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>

                    {/* Error message */}
                    {authError && (
                      <div className='mt-1 space-y-1 text-center text-red-400 text-xs'>
                        <p>{authError}</p>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={() => handleVerifyOtp()}
                    className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
                    disabled={otpValue.length !== 6 || isVerifyingOtp}
                  >
                    {isVerifyingOtp ? 'Verifying...' : 'Verify Email'}
                  </Button>

                  <div className='text-center'>
                    <p className='text-muted-foreground text-sm'>
                      Didn't receive a code?{' '}
                      {countdown > 0 ? (
                        <span>
                          Resend in{' '}
                          <span className='font-medium text-foreground'>{countdown}s</span>
                        </span>
                      ) : (
                        <button
                          className='font-medium text-[var(--brand-accent-hex)] underline-offset-4 transition hover:text-[var(--brand-accent-hover-hex)] hover:underline'
                          onClick={handleResendOtp}
                          disabled={isVerifyingOtp || isResendDisabled}
                        >
                          Resend
                        </button>
                      )}
                    </p>
                  </div>

                  <div className='text-center font-light text-[14px]'>
                    <button
                      onClick={() => {
                        setShowOtpVerification(false)
                        setOtpValue('')
                        setAuthError(null)
                      }}
                      className='font-medium text-[var(--brand-accent-hex)] underline-offset-4 transition hover:text-[var(--brand-accent-hover-hex)] hover:underline'
                    >
                      Change email
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
