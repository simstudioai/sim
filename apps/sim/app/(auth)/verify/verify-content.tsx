'use client'

import { Suspense, useEffect, useState } from 'react'
import { cn, InputOTP, InputOTPGroup, InputOTPSlot } from '@sim/emcn'
import { POST_AUTH_REDIRECT_STORAGE_KEY } from '@/app/(auth)/auth-redirect'
import {
  AuthFormMessage,
  AuthHeader,
  AuthNavPrompt,
  AuthSubmitButton,
  AuthTextLink,
} from '@/app/(auth)/components'
import { useVerification } from '@/app/(auth)/verify/use-verification'

interface VerifyContentProps {
  hasEmailService: boolean
  isProduction: boolean
  isEmailVerificationEnabled: boolean
}

const OTP_SLOTS = [0, 1, 2, 3, 4, 5] as const

function VerificationForm({
  hasEmailService,
  isProduction,
  isEmailVerificationEnabled,
}: {
  hasEmailService: boolean
  isProduction: boolean
  isEmailVerificationEnabled: boolean
}) {
  const {
    otp,
    email,
    status,
    isResending,
    errorMessage,
    isOtpComplete,
    verifyCode,
    resendCode,
    handleOtpChange,
  } = useVerification({ hasEmailService, isProduction, isEmailVerificationEnabled })

  const isVerified = status === 'verified'
  const isLoading = status === 'verifying' || isResending
  const isInvalidOtp = status === 'error'

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

  const handleResend = () => {
    resendCode()
    setIsResendDisabled(true)
    setCountdown(30)
  }

  return (
    <div className='space-y-6'>
      <AuthHeader
        title={isVerified ? 'Email Verified' : 'Verify your email'}
        description={
          isVerified
            ? 'Your email has been verified. Redirecting to dashboard...'
            : !isEmailVerificationEnabled
              ? 'Email verification is disabled. Redirecting to dashboard...'
              : hasEmailService
                ? `A verification code has been sent to ${email || 'your email'}`
                : !isProduction
                  ? 'Development mode: Check your console logs for the verification code'
                  : 'Error: Email verification is enabled but no email service is configured'
        }
      />

      {!isVerified && isEmailVerificationEnabled && (
        <div className='space-y-6'>
          <div className='space-y-5'>
            <p className='text-center text-[var(--text-muted)] text-sm'>
              Enter the 6-digit code to verify your account.
              {hasEmailService ? " If you don't see it in your inbox, check your spam folder." : ''}
            </p>

            <div className='flex justify-center'>
              <InputOTP maxLength={6} value={otp} onChange={handleOtpChange} disabled={isLoading}>
                <InputOTPGroup>
                  {OTP_SLOTS.map((index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      className={cn(isInvalidOtp && 'border-[var(--text-error)]')}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            {errorMessage && (
              <AuthFormMessage type='error' align='center'>
                <p>{errorMessage}</p>
              </AuthFormMessage>
            )}
          </div>

          <AuthSubmitButton
            type='button'
            onClick={verifyCode}
            loading={isLoading}
            loadingLabel='Verifying…'
            disabled={!isOtpComplete}
          >
            Verify Email
          </AuthSubmitButton>

          {hasEmailService && (
            <p className='text-center text-[var(--text-muted)] text-sm'>
              Didn't receive a code?{' '}
              {countdown > 0 ? (
                <span>
                  Resend in <span className='text-[var(--text-primary)]'>{countdown}s</span>
                </span>
              ) : (
                <AuthTextLink onClick={handleResend} disabled={isLoading || isResendDisabled}>
                  Resend
                </AuthTextLink>
              )}
            </p>
          )}

          <AuthNavPrompt
            href='/signup'
            linkLabel='Back to signup'
            onNavigate={() => {
              if (typeof window !== 'undefined') {
                sessionStorage.removeItem('verificationEmail')
                sessionStorage.removeItem(POST_AUTH_REDIRECT_STORAGE_KEY)
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

function VerificationFormFallback() {
  return (
    <div className='text-center'>
      <div className='animate-pulse'>
        <div className='mx-auto mb-4 h-8 w-48 rounded bg-[var(--surface-4)]' />
        <div className='mx-auto h-4 w-64 rounded bg-[var(--surface-4)]' />
      </div>
    </div>
  )
}

export function VerifyContent({
  hasEmailService,
  isProduction,
  isEmailVerificationEnabled,
}: VerifyContentProps) {
  return (
    <Suspense fallback={<VerificationFormFallback />}>
      <VerificationForm
        hasEmailService={hasEmailService}
        isProduction={isProduction}
        isEmailVerificationEnabled={isEmailVerificationEnabled}
      />
    </Suspense>
  )
}
