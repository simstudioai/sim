'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useNotificationStore } from '@/stores/notifications/store'

const logger = createLogger('VerifyPage')

// Extract the content into a separate component
function VerifyContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addNotification } = useNotificationStore()
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [isSendingInitialOtp, setIsSendingInitialOtp] = useState(false)

  // Get email from URL query param
  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam))
    }
  }, [searchParams])

  // Send initial OTP code if this is the first load
  useEffect(() => {
    if (email && !isSendingInitialOtp) {
      setIsSendingInitialOtp(true)
      // Send verification OTP on initial page load
      client.emailOtp
        .sendVerificationOtp({
          email,
          type: 'email-verification',
        })
        .then(() => {})
        .catch((error) => {
          logger.error('Failed to send initial verification code:', error)
          addNotification?.(
            'error',
            'Failed to send verification code. Please use the resend button.',
            null
          )
        })
    }
  }, [email, isSendingInitialOtp, addNotification])

  // Enable the verify button when all 6 digits are entered
  const isOtpComplete = otp.length === 6

  async function verifyCode() {
    if (!isOtpComplete || !email) return

    setIsLoading(true)

    try {
      // Call the verification API with the OTP code
      await client.emailOtp.verifyEmail({
        email,
        otp,
      })

      setIsVerified(true)

      // Redirect to dashboard after a short delay
      setTimeout(() => router.push('/w'), 2000)
    } catch (error: any) {
      let errorMessage = 'Verification failed. Please check your code and try again.'

      if (error.message?.includes('expired')) {
        errorMessage = 'The verification code has expired. Please request a new one.'
      } else if (error.message?.includes('invalid')) {
        errorMessage = 'Invalid verification code. Please check and try again.'
      } else if (error.message?.includes('attempts')) {
        errorMessage = 'Too many failed attempts. Please request a new code.'
      }

      addNotification?.('error', errorMessage, null)
    } finally {
      setIsLoading(false)
    }
  }

  function resendCode() {
    if (!email) return

    setIsLoading(true)

    client.emailOtp
      .sendVerificationOtp({
        email,
        type: 'email-verification',
      })
      .then(() => {})
      .catch(() => {
        addNotification?.(
          'error',
          'Failed to resend verification code. Please try again later.',
          null
        )
      })
      .finally(() => {
        setIsLoading(false)
      })
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{isVerified ? 'Email Verified!' : 'Verify your email'}</CardTitle>
        <CardDescription>
          {isVerified
            ? 'Your email has been verified. Redirecting to dashboard...'
            : `A verification code has been sent to ${email || 'your email'}`}
        </CardDescription>
      </CardHeader>

      {!isVerified && (
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground mb-2">
            Enter the 6-digit code from your email to verify your account. If you don't see it,
            check your spam folder.
          </p>
          <div className="flex justify-center py-4">
            <InputOTP maxLength={6} value={otp} onChange={setOtp} disabled={isLoading}>
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
          <Button onClick={verifyCode} className="w-full" disabled={!isOtpComplete || isLoading}>
            {isLoading ? 'Verifying...' : 'Verify Email'}
          </Button>
        </CardContent>
      )}

      {!isVerified && (
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
    </Card>
  )
}

export default function VerifyPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">Sim Studio</h1>
        <Suspense
          fallback={
            <Card className="w-full">
              <CardHeader>
                <CardTitle>Verify your email</CardTitle>
                <CardDescription>Loading verification page...</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-10 animate-pulse bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          }
        >
          <VerifyContent />
        </Suspense>
      </div>
    </main>
  )
}
