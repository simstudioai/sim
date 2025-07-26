'use client'

import { Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { cn } from '@/lib/utils'
import { useVerification } from '@/app/(auth)/verify/use-verification'

interface VerifyContentProps {
  hasResendKey: boolean
  baseUrl: string
  isProduction: boolean
}

function VerificationForm({
  hasResendKey,
  isProduction,
}: {
  hasResendKey: boolean
  isProduction: boolean
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
  } = useVerification({ hasResendKey, isProduction })

  const [countdown, setCountdown] = useState(0)
  const [isResendDisabled, setIsResendDisabled] = useState(false)

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
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
      <div className='space-y-2 text-center'>
        <h1 className='font-semibold text-[32px] text-white tracking-tight'>
          {isVerified ? 'Email Verified!' : 'Verify Your Email'}
        </h1>
        <p className='text-neutral-400 text-sm'>
          {isVerified
            ? 'Your email has been verified. Redirecting to dashboard...'
            : hasResendKey
              ? `A verification code has been sent to ${email || 'your email'}`
              : !isProduction
                ? 'Development mode: Check your console logs for the verification code'
                : 'Error: Invalid API key configuration'}
        </p>
      </div>

      {!isVerified && (
        <div className='flex flex-col gap-6'>
          <div className='rounded-xl border border-neutral-700/40 bg-neutral-800/50 p-6 backdrop-blur-sm'>
            <p className='mb-4 text-neutral-400 text-sm'>
              Enter the 6-digit code to verify your account.
              {hasResendKey ? " If you don't see it in your inbox, check your spam folder." : ''}
            </p>

            <div className='flex justify-center py-4'>
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={handleOtpChange}
                disabled={isLoading}
                className={cn(
                  isInvalidOtp ? 'border-red-500 focus-visible:ring-red-500' : 'border-neutral-700'
                )}
              >
                <InputOTPGroup>
                  <InputOTPSlot
                    index={0}
                    className='border-neutral-700 bg-neutral-900 text-white'
                  />
                  <InputOTPSlot
                    index={1}
                    className='border-neutral-700 bg-neutral-900 text-white'
                  />
                  <InputOTPSlot
                    index={2}
                    className='border-neutral-700 bg-neutral-900 text-white'
                  />
                  <InputOTPSlot
                    index={3}
                    className='border-neutral-700 bg-neutral-900 text-white'
                  />
                  <InputOTPSlot
                    index={4}
                    className='border-neutral-700 bg-neutral-900 text-white'
                  />
                  <InputOTPSlot
                    index={5}
                    className='border-neutral-700 bg-neutral-900 text-white'
                  />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {/* Error message */}
            {errorMessage && (
              <div className='mt-2 mb-4 rounded-md border border-red-900/20 bg-red-900/10 py-2 text-center'>
                <p className='font-medium text-red-400 text-sm'>{errorMessage}</p>
              </div>
            )}

            <Button
              onClick={verifyCode}
              className='h-11 w-full bg-[#701ffc] font-medium text-base text-white shadow-[#701ffc]/20 shadow-lg transition-colors duration-200 hover:bg-[#802FFF]'
              disabled={!isOtpComplete || isLoading}
            >
              {isLoading ? 'Verifying...' : 'Verify Email'}
            </Button>

            {hasResendKey && (
              <div className='mt-4 text-center'>
                <p className='text-neutral-400 text-sm'>
                  Didn't receive a code?{' '}
                  {countdown > 0 ? (
                    <span>
                      Resend in <span className='font-medium text-neutral-300'>{countdown}s</span>
                    </span>
                  ) : (
                    <button
                      className='font-medium text-[#9D54FF] underline-offset-4 transition hover:text-[#a66fff] hover:underline'
                      onClick={handleResend}
                      disabled={isLoading || isResendDisabled}
                    >
                      Resend
                    </button>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Fallback component while the verification form is loading
function VerificationFormFallback() {
  return (
    <div className='p-8 text-center'>
      <div className='animate-pulse'>
        <div className='mx-auto mb-4 h-8 w-48 rounded bg-neutral-800' />
        <div className='mx-auto h-4 w-64 rounded bg-neutral-800' />
      </div>
    </div>
  )
}

export function VerifyContent({ hasResendKey, baseUrl, isProduction }: VerifyContentProps) {
  return (
    <Suspense fallback={<VerificationFormFallback />}>
      <VerificationForm hasResendKey={hasResendKey} isProduction={isProduction} />
    </Suspense>
  )
}
