'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { useVerification } from '@/app/(auth)/verify/use-verification'

interface VerifyContentProps {
  hasEmailService: boolean
  isProduction: boolean
  isEmailVerificationEnabled: boolean
}

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
    isLoading,
    isVerified,
    isInvalidOtp,
    errorMessage,
    isOtpComplete,
    verifyCode,
    resendCode,
    handleOtpChange,
  } = useVerification({ hasEmailService, isProduction, isEmailVerificationEnabled })

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

  const router = useRouter()

  const handleResend = () => {
    resendCode()
    setIsResendDisabled(true)
    setCountdown(30)
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
          {isVerified ? 'Email Verified!' : 'Verify Your Email'}
        </h1>
        <p className='font-[430] font-season text-[#F6F6F6]/60 text-[18px] leading-[125%] tracking-[0.02em]'>
          {isVerified
            ? 'Your email has been verified. Redirecting to dashboard...'
            : !isEmailVerificationEnabled
              ? 'Email verification is disabled. Redirecting to dashboard...'
              : hasEmailService
                ? `A verification code has been sent to ${email || 'your email'}`
                : !isProduction
                  ? 'Development mode: Check your console logs for the verification code'
                  : 'Error: Email verification is enabled but no email service is configured'}
        </p>
      </div>

      {!isVerified && isEmailVerificationEnabled && (
        <div className='mt-8 space-y-8'>
          <div className='space-y-6'>
            <p className='text-center text-[#999] text-sm'>
              Enter the 6-digit code to verify your account.
              {hasEmailService ? " If you don't see it in your inbox, check your spam folder." : ''}
            </p>

            <div className='flex justify-center'>
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={handleOtpChange}
                disabled={isLoading}
                className={cn('gap-2', isInvalidOtp && 'otp-error')}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} className={cn(isInvalidOtp && 'border-red-500')} />
                  <InputOTPSlot index={1} className={cn(isInvalidOtp && 'border-red-500')} />
                  <InputOTPSlot index={2} className={cn(isInvalidOtp && 'border-red-500')} />
                  <InputOTPSlot index={3} className={cn(isInvalidOtp && 'border-red-500')} />
                  <InputOTPSlot index={4} className={cn(isInvalidOtp && 'border-red-500')} />
                  <InputOTPSlot index={5} className={cn(isInvalidOtp && 'border-red-500')} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {/* Error message */}
            {errorMessage && (
              <div className='mt-1 space-y-1 text-center text-red-400 text-xs'>
                <p>{errorMessage}</p>
              </div>
            )}
          </div>

          <BrandedButton
            onClick={verifyCode}
            disabled={!isOtpComplete || isLoading}
            loading={isLoading}
            loadingText='Verifying'
            showArrow={false}
          >
            Verify Email
          </BrandedButton>

          {hasEmailService && (
            <div className='text-center'>
              <p className='text-[#999] text-sm'>
                Didn't receive a code?{' '}
                {countdown > 0 ? (
                  <span>
                    Resend in <span className='font-medium text-[#ECECEC]'>{countdown}s</span>
                  </span>
                ) : (
                  <button
                    className='font-medium text-[#ECECEC] underline-offset-4 transition hover:text-white hover:underline'
                    onClick={handleResend}
                    disabled={isLoading || isResendDisabled}
                  >
                    Resend
                  </button>
                )}
              </p>
            </div>
          )}

          <div className='text-center font-light text-[14px]'>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') {
                  sessionStorage.removeItem('verificationEmail')
                  sessionStorage.removeItem('inviteRedirectUrl')
                  sessionStorage.removeItem('isInviteFlow')
                }
                router.push('/signup')
              }}
              className='font-medium text-[#ECECEC] underline-offset-4 transition hover:text-white hover:underline'
            >
              Back to signup
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function VerificationFormFallback() {
  return (
    <div className='text-center'>
      <div className='animate-pulse'>
        <div className='mx-auto mb-4 h-8 w-48 rounded bg-[#2A2A2A]' />
        <div className='mx-auto h-4 w-64 rounded bg-[#2A2A2A]' />
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
