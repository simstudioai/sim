'use client'

import { type KeyboardEvent, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Loader2 } from 'lucide-react'
import { Input, InputOTP, InputOTPGroup, InputOTPSlot, Label } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import Navbar from '@/app/(home)/components/navbar/navbar'

const logger = createLogger('EmailAuth')

interface EmailAuthProps {
  identifier: string
  onAuthSuccess: () => void
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

export default function EmailAuth({ identifier, onAuthSuccess }: EmailAuthProps) {
  const [email, setEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)

  const [showOtpVerification, setShowOtpVerification] = useState(false)
  const [otpValue, setOtpValue] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [isResendDisabled, setIsResendDisabled] = useState(false)

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
      return () => clearTimeout(timer)
    }
    if (countdown === 0 && isResendDisabled) {
      setIsResendDisabled(false)
    }
  }, [countdown, isResendDisabled])

  const handleEmailKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSendOtp()
    }
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)
    const errors = validateEmailField(newEmail)
    setEmailErrors(errors)
    setShowEmailValidationError(false)
  }

  const handleSendOtp = async () => {
    const emailValidationErrors = validateEmailField(email)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    if (emailValidationErrors.length > 0) {
      return
    }

    setAuthError(null)
    setIsSendingOtp(true)

    try {
      const response = await fetch(`/api/chat/${identifier}/otp`, {
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
      const response = await fetch(`/api/chat/${identifier}/otp`, {
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
      const response = await fetch(`/api/chat/${identifier}/otp`, {
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
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-full flex-col text-[var(--landing-text)]'>
        <header className='shrink-0 bg-[var(--landing-bg)]'>
          <Navbar logoOnly />
        </header>
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
                  {showOtpVerification ? 'Verify Your Email' : 'Email Verification'}
                </h1>
                <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
                  {showOtpVerification
                    ? `A verification code has been sent to ${email}`
                    : 'This chat requires email verification'}
                </p>
              </div>

              <div className='mt-8 w-full max-w-[410px]'>
                {!showOtpVerification ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleSendOtp()
                    }}
                    className='space-y-6'
                  >
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
                          showEmailValidationError &&
                            emailErrors.length > 0 &&
                            'border-red-500 focus:border-red-500'
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

                    <button type='submit' disabled={isSendingOtp} className={AUTH_SUBMIT_BTN}>
                      {isSendingOtp ? (
                        <span className='flex items-center gap-2'>
                          <Loader2 className='h-4 w-4 animate-spin' />
                          Sending Code...
                        </span>
                      ) : (
                        'Continue'
                      )}
                    </button>
                  </form>
                ) : (
                  <div className='space-y-6'>
                    <p className='text-center text-[var(--landing-text-muted)] text-sm'>
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
                        <InputOTPGroup>
                          {[0, 1, 2, 3, 4, 5].map((index) => (
                            <InputOTPSlot
                              key={index}
                              index={index}
                              className={cn(authError && 'border-red-500')}
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>

                    {authError && (
                      <div className='mt-1 space-y-1 text-center text-red-400 text-xs'>
                        <p>{authError}</p>
                      </div>
                    )}

                    <button
                      onClick={() => handleVerifyOtp()}
                      disabled={otpValue.length !== 6 || isVerifyingOtp}
                      className='inline-flex h-[32px] w-full items-center justify-center gap-2 rounded-[5px] border border-white bg-white px-2.5 font-[430] font-season text-black text-sm transition-colors hover:border-[var(--border-1)] hover:bg-[var(--border-1)] disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      {isVerifyingOtp ? (
                        <span className='flex items-center gap-2'>
                          <Loader2 className='h-4 w-4 animate-spin' />
                          Verifying...
                        </span>
                      ) : (
                        'Verify Email'
                      )}
                    </button>

                    <div className='text-center'>
                      <p className='text-[var(--landing-text-muted)] text-sm'>
                        Didn't receive a code?{' '}
                        {countdown > 0 ? (
                          <span>
                            Resend in{' '}
                            <span className='font-medium text-[var(--landing-text)]'>
                              {countdown}s
                            </span>
                          </span>
                        ) : (
                          <button
                            className='font-medium text-[var(--brand-link)] underline-offset-4 transition hover:text-[var(--brand-link-hover)] hover:underline'
                            onClick={handleResendOtp}
                            disabled={isVerifyingOtp || isResendDisabled}
                          >
                            Resend
                          </button>
                        )}
                      </p>
                    </div>

                    <div className='text-center font-light text-sm'>
                      <button
                        onClick={() => {
                          setShowOtpVerification(false)
                          setOtpValue('')
                          setAuthError(null)
                        }}
                        className='font-medium text-[var(--brand-link)] underline-offset-4 transition hover:text-[var(--brand-link-hover)] hover:underline'
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
        <SupportFooter position='absolute' />
      </main>
    </AuthBackground>
  )
}
