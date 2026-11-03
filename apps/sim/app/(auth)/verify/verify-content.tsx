'use client'

import { Suspense, useEffect, useState } from 'react'
import { AuthCodeEntry } from '@sim/auth-ui'
import { POST_AUTH_REDIRECT_STORAGE_KEY } from '@/app/(auth)/auth-redirect'
import { AuthHeader, AuthNavPrompt } from '@/app/(auth)/components'
import VerifyLoading from '@/app/(auth)/verify/loading'
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
  const { otp, email, status, isResending, errorMessage, verifyCode, resendCode, handleOtpChange } =
    useVerification({ hasEmailService, isProduction, isEmailVerificationEnabled })

  const isVerified = status === 'verified'

  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const handleResend = () => {
    resendCode()
    setCountdown(30)
  }

  return (
    <div className='au:space-y-[var(--auth-group-gap)]'>
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
                  ? 'Email delivery is not configured on this development deployment.'
                  : 'Error: Email verification is enabled but no email service is configured'
        }
      />

      {!isVerified && isEmailVerificationEnabled && (
        <div className='au:space-y-[var(--auth-group-gap)]'>
          <AuthCodeEntry
            value={otp}
            onChange={handleOtpChange}
            onVerify={() => {
              void verifyCode()
            }}
            onResend={hasEmailService ? handleResend : undefined}
            verifying={status === 'verifying'}
            resending={isResending}
            countdown={countdown}
            error={errorMessage}
            help={
              hasEmailService
                ? 'Check your spam folder, or return to signup to use a different email address.'
                : undefined
            }
          />

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

export function VerifyContent({
  hasEmailService,
  isProduction,
  isEmailVerificationEnabled,
}: VerifyContentProps) {
  return (
    <Suspense fallback={<VerifyLoading />}>
      <VerificationForm
        hasEmailService={hasEmailService}
        isProduction={isProduction}
        isEmailVerificationEnabled={isEmailVerificationEnabled}
      />
    </Suspense>
  )
}
