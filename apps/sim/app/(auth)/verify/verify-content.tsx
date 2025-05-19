'use client'

import { Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { cn } from '@/lib/utils'
import { useVerification } from './use-verification'

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
    } else if (countdown === 0 && isResendDisabled) {
      setIsResendDisabled(false)
    }
  }, [countdown, isResendDisabled])

  const handleResend = () => {
    resendCode()
    setIsResendDisabled(true)
    setCountdown(30)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-[32px] font-semibold tracking-tight text-white">
          {isVerified ? 'Email Verified!' : 'Verify Your Email'}
        </h1>
        <p className="text-sm text-neutral-400">
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
        <div className="flex flex-col gap-6">
          <div className="bg-neutral-800/50 backdrop-blur-sm border border-neutral-700/40 rounded-xl p-6">
            <p className="text-sm text-neutral-400 mb-4">
              Enter the 6-digit code to verify your account.
              {hasResendKey ? " If you don't see it in your inbox, check your spam folder." : ''}
            </p>

            <div className="flex justify-center py-4">
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
                    className="bg-neutral-900 border-neutral-700 text-white"
                  />
                  <InputOTPSlot
                    index={1}
                    className="bg-neutral-900 border-neutral-700 text-white"
                  />
                  <InputOTPSlot
                    index={2}
                    className="bg-neutral-900 border-neutral-700 text-white"
                  />
                  <InputOTPSlot
                    index={3}
                    className="bg-neutral-900 border-neutral-700 text-white"
                  />
                  <InputOTPSlot
                    index={4}
                    className="bg-neutral-900 border-neutral-700 text-white"
                  />
                  <InputOTPSlot
                    index={5}
                    className="bg-neutral-900 border-neutral-700 text-white"
                  />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {/* Error message */}
            {errorMessage && (
              <div className="mt-2 mb-4 text-center border border-red-900/20 rounded-md py-2 bg-red-900/10">
                <p className="text-sm font-medium text-red-400">{errorMessage}</p>
              </div>
            )}

            <Button
              onClick={verifyCode}
              className="w-full bg-[#701ffc] hover:bg-[#802FFF] h-11 font-medium text-base text-white shadow-lg shadow-[#701ffc]/20 transition-colors duration-200"
              disabled={!isOtpComplete || isLoading}
            >
              {isLoading ? 'Verifying...' : 'Verify Email'}
            </Button>

            {hasResendKey && (
              <div className="mt-4 text-center">
                <p className="text-sm text-neutral-400">
                  Didn't receive a code?{' '}
                  {countdown > 0 ? (
                    <span>
                      Resend in <span className="font-medium text-neutral-300">{countdown}s</span>
                    </span>
                  ) : (
                    <button
                      className="text-[#9D54FF] hover:text-[#a66fff] font-medium transition underline-offset-4 hover:underline"
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
    <div className="text-center p-8">
      <div className="animate-pulse">
        <div className="h-8 bg-neutral-800 rounded w-48 mx-auto mb-4"></div>
        <div className="h-4 bg-neutral-800 rounded w-64 mx-auto"></div>
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
