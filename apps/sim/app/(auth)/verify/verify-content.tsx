'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { cn } from '@/lib/utils'
import { useVerification } from '@/app/(auth)/verify/use-verification'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

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
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
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

  const [buttonClass, setButtonClass] = useState('auth-button-gradient')

  useEffect(() => {
    const checkCustomBrand = () => {
      const computedStyle = getComputedStyle(document.documentElement)
      const brandAccent = computedStyle.getPropertyValue('--brand-accent-hex').trim()

      if (brandAccent && brandAccent !== '#6f3dfa') {
        setButtonClass('auth-button-custom')
      } else {
        setButtonClass('auth-button-gradient')
      }
    }

    checkCustomBrand()

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

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
          {isVerified ? 'Email Verified!' : 'Verify Your Email'}
        </h1>
        <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
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
        <div className={`${inter.className} mt-8 space-y-8`}>
          <div className='space-y-6'>
            <p className='text-center text-muted-foreground text-sm'>
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
                <InputOTPGroup className='[&>div]:!rounded-[10px] gap-2'>
                  <InputOTPSlot
                    index={0}
                    className={cn(
                      '!rounded-[10px] h-12 w-12 border bg-white text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={1}
                    className={cn(
                      '!rounded-[10px] h-12 w-12 border bg-white text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={2}
                    className={cn(
                      '!rounded-[10px] h-12 w-12 border bg-white text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={3}
                    className={cn(
                      '!rounded-[10px] h-12 w-12 border bg-white text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={4}
                    className={cn(
                      '!rounded-[10px] h-12 w-12 border bg-white text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
                  <InputOTPSlot
                    index={5}
                    className={cn(
                      '!rounded-[10px] h-12 w-12 border bg-white text-center font-medium text-lg shadow-sm transition-all duration-200',
                      'border-gray-300 hover:border-gray-400',
                      'focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100',
                      isInvalidOtp && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                    )}
                  />
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

          <Button
            onClick={verifyCode}
            className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
            disabled={!isOtpComplete || isLoading}
          >
            {isLoading ? 'Verifying...' : 'Verify Email'}
          </Button>

          {hasEmailService && (
            <div className='text-center'>
              <p className='text-muted-foreground text-sm'>
                Didn't receive a code?{' '}
                {countdown > 0 ? (
                  <span>
                    Resend in <span className='font-medium text-foreground'>{countdown}s</span>
                  </span>
                ) : (
                  <button
                    className='font-medium text-[var(--brand-accent-hex)] underline-offset-4 transition hover:text-[var(--brand-accent-hover-hex)] hover:underline'
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
              className='font-medium text-[var(--brand-accent-hex)] underline-offset-4 transition hover:text-[var(--brand-accent-hover-hex)] hover:underline'
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
        <div className='mx-auto mb-4 h-8 w-48 rounded bg-gray-200' />
        <div className='mx-auto h-4 w-64 rounded bg-gray-200' />
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
