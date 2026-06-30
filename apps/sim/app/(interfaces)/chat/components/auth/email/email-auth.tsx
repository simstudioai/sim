'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { Input, InputOTP, InputOTPGroup, InputOTPSlot, Label } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AuthSubmitButton } from '@/app/(auth)/components'
import { AUTH_TEXT_LINK } from '@/app/(auth)/components/auth-button-classes'
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
    <div className='flex flex-1 items-center justify-center px-4 py-16'>
      <div className='w-full max-w-[410px]'>
        <div className='flex flex-col items-center justify-center'>
          <div className='space-y-1 text-center'>
            <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
              {showOtpVerification ? 'Verify Your Email' : 'Email Verification'}
            </h1>
            <p className='text-[color-mix(in_srgb,var(--text-muted)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
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
                        'border-[var(--text-error)] focus:border-[var(--text-error)]'
                    )}
                  />
                  {showEmailValidationError && emailErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-[var(--text-error)] text-xs'>
                      {emailErrors.map((error) => (
                        <p key={error}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>

                <AuthSubmitButton
                  type='submit'
                  loading={requestOtp.isPending}
                  loadingLabel='Sending Code…'
                >
                  Continue
                </AuthSubmitButton>
              </form>
            ) : (
              <div className='space-y-6'>
                <p className='text-center text-[var(--text-muted)] text-sm'>
                  Enter the 6-digit code to verify your account. If you don't see it in your inbox,
                  check your spam folder.
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
                          className={cn(authError && 'border-[var(--text-error)]')}
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                {authError && (
                  <div className='mt-1 space-y-1 text-center text-[var(--text-error)] text-xs'>
                    <p>{authError}</p>
                  </div>
                )}

                <AuthSubmitButton
                  onClick={() => handleVerifyOtp()}
                  disabled={otpValue.length !== 6}
                  loading={verifyOtp.isPending}
                  loadingLabel='Verifying…'
                >
                  Verify Email
                </AuthSubmitButton>

                <div className='text-center'>
                  <p className='text-[var(--text-muted)] text-sm'>
                    Didn't receive a code?{' '}
                    {countdown > 0 ? (
                      <span>
                        Resend in{' '}
                        <span className='font-medium text-[var(--text-primary)]'>{countdown}s</span>
                      </span>
                    ) : (
                      <button
                        className={AUTH_TEXT_LINK}
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
                    className={AUTH_TEXT_LINK}
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
  )
}
