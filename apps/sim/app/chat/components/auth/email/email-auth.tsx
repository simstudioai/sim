'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { Loader2 } from 'lucide-react'
import { Input, InputOTP, InputOTPGroup, InputOTPSlot, Label } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import Navbar from '@/app/(landing)/components/navbar/navbar'
import { useChatEmailOtpRequest, useChatEmailOtpVerify } from '@/hooks/queries/chats'

const logger = createLogger('EmailAuth')

interface EmailAuthProps {
  identifier: string
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

export default function EmailAuth({ identifier }: EmailAuthProps) {
  const [email, setEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)

  const [showOtpVerification, setShowOtpVerification] = useState(false)
  const [otpValue, setOtpValue] = useState('')
  const [countdown, setCountdown] = useState(0)

  const requestOtp = useChatEmailOtpRequest(identifier)
  const verifyOtp = useChatEmailOtpVerify(identifier)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

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

    try {
      await requestOtp.mutateAsync({ email })
      setShowOtpVerification(true)
    } catch (error) {
      logger.error('Error sending OTP:', error)
      setEmailErrors([toError(error).message || 'Failed to send verification code'])
      setShowEmailValidationError(true)
    }
  }

  const handleVerifyOtp = async (otp?: string) => {
    const codeToVerify = otp || otpValue

    if (!codeToVerify || codeToVerify.length !== 6) {
      return
    }

    setAuthError(null)

    try {
      await verifyOtp.mutateAsync({ email, otp: codeToVerify })
    } catch (error) {
      logger.error('Error verifying OTP:', error)
      setAuthError(toError(error).message || 'Invalid verification code')
    }
  }

  const handleResendOtp = async () => {
    setAuthError(null)
    setCountdown(30)

    try {
      await requestOtp.mutateAsync({ email })
      setOtpValue('')
    } catch (error) {
      logger.error('Error resending OTP:', error)
      setAuthError(toError(error).message || 'Failed to resend verification code')
      setCountdown(0)
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

                    <button
                      type='submit'
                      disabled={requestOtp.isPending}
                      className={AUTH_SUBMIT_BTN}
                    >
                      {requestOtp.isPending ? (
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
                        disabled={verifyOtp.isPending}
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
                      disabled={otpValue.length !== 6 || verifyOtp.isPending}
                      className={AUTH_SUBMIT_BTN}
                    >
                      {verifyOtp.isPending ? (
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
                            disabled={verifyOtp.isPending || requestOtp.isPending}
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
