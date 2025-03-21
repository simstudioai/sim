'use client'

import { Suspense } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

  return (
    <>
      <CardHeader>
        <CardTitle>{isVerified ? 'Email Verified!' : 'Verify your email'}</CardTitle>
        <CardDescription>
          {isVerified ? (
            'Your email has been verified. Redirecting to dashboard...'
          ) : hasResendKey ? (
            <p>A verification code has been sent to {email || 'your email'}</p>
          ) : !isProduction ? (
            <div className="space-y-1">
              <p>Development mode: No Resend API key configured</p>
              <p className="text-xs text-muted-foreground italic">
                Check your console logs for the verification code
              </p>
            </div>
          ) : (
            <p>Error: Invalid API key configuration</p>
          )}
        </CardDescription>
      </CardHeader>

      {/* Add debug output for error state */}
      <div className="hidden">
        Debug - isInvalidOtp: {String(isInvalidOtp)}, errorMessage: {errorMessage || 'none'}
      </div>

      {!isVerified && (
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground mb-2">
            Enter the 6-digit code to verify your account.
            {hasResendKey ? " If you don't see it in your email, check your spam folder." : ''}
          </p>
          <div className="flex flex-col items-center space-y-2">
            <div className="flex justify-center py-4">
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={handleOtpChange}
                disabled={isLoading}
                className={cn(isInvalidOtp && 'border-red-500 focus-visible:ring-red-500')}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>

          {/* Error message - moved above the button for better visibility */}
          {errorMessage && (
            <div className="mt-2 mb-2 text-center border border-red-200 rounded-md py-2 bg-red-50">
              <p className="text-sm font-semibold text-red-600">{errorMessage}</p>
            </div>
          )}

          <Button onClick={verifyCode} className="w-full" disabled={!isOtpComplete || isLoading}>
            {isLoading ? 'Verifying...' : 'Verify Email'}
          </Button>
        </CardContent>
      )}

      {!isVerified && hasResendKey && (
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            Didn't receive a code?{' '}
            <button
              className="text-primary hover:underline font-medium"
              onClick={resendCode}
              disabled={isLoading}
            >
              Resend
            </button>
          </p>
        </CardFooter>
      )}
    </>
  )
}

// Fallback component while the verification form is loading
function VerificationFormFallback() {
  return (
    <CardHeader>
      <CardTitle>Loading verification...</CardTitle>
      <CardDescription>Please wait while we load your verification details...</CardDescription>
    </CardHeader>
  )
}

export function VerifyContent({ hasResendKey, baseUrl, isProduction }: VerifyContentProps) {
  return (
    <Card className="w-full">
      <Suspense fallback={<VerificationFormFallback />}>
        <VerificationForm hasResendKey={hasResendKey} isProduction={isProduction} />
      </Suspense>
    </Card>
  )
}
