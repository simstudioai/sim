'use client'

import { useEffect, useState } from 'react'
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
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'

const logger = createLogger('VerifyContent')

interface VerifyContentProps {
  hasResendKey: boolean
  baseUrl: string
  isProduction: boolean
}

export function VerifyContent({ hasResendKey, baseUrl, isProduction }: VerifyContentProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addNotification } = useNotificationStore()
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [isSendingInitialOtp, setIsSendingInitialOtp] = useState(false)
  const [isInvalidOtp, setIsInvalidOtp] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Debug notification store
  useEffect(() => {
    logger.info('Notification store state:', { addNotification: !!addNotification })
  }, [addNotification])

  // Get email from URL query param
  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam))
    }
  }, [searchParams])

  // Send initial OTP code if this is the first load
  useEffect(() => {
    if (email && !isSendingInitialOtp && hasResendKey) {
      setIsSendingInitialOtp(true)

      // Only send verification OTP if we're coming from login page
      // Skip this if coming from signup since the OTP is already sent
      if (!searchParams.get('fromSignup')) {
        client.emailOtp
          .sendVerificationOtp({
            email,
            type: 'email-verification',
          })
          .then(() => {})
          .catch((error) => {
            logger.error('Failed to send initial verification code:', error)
            setErrorMessage('Failed to send verification code. Please use the resend button.')
          })
      }
    }
  }, [email, isSendingInitialOtp, searchParams, hasResendKey])

  // Enable the verify button when all 6 digits are entered
  const isOtpComplete = otp.length === 6

  async function verifyCode() {
    if (!isOtpComplete || !email) return

    setIsLoading(true)
    setIsInvalidOtp(false)
    setErrorMessage('')

    try {
      // Call the verification API with the OTP code
      const response = await client.emailOtp.verifyEmail({
        email,
        otp,
      })

      // Check if verification was successful
      if (response && !response.error) {
        setIsVerified(true)
        // Redirect to dashboard after a short delay
        setTimeout(() => router.push('/w'), 2000)
      } else {
        logger.info('Setting invalid OTP state - API error response')
        const message = 'Invalid verification code. Please check and try again.'
        // Set both state variables to ensure the error shows
        setIsInvalidOtp(true)
        setErrorMessage(message)
        logger.info('Error state after API error:', { isInvalidOtp: true, errorMessage: message })
        // Clear the OTP input on invalid code
        setOtp('')
      }
    } catch (error: any) {
      let message = 'Verification failed. Please check your code and try again.'

      if (error.message?.includes('expired')) {
        message = 'The verification code has expired. Please request a new one.'
      } else if (error.message?.includes('invalid')) {
        logger.info('Setting invalid OTP state - caught error')
        message = 'Invalid verification code. Please check and try again.'
      } else if (error.message?.includes('attempts')) {
        message = 'Too many failed attempts. Please request a new code.'
      }

      // Set both state variables to ensure the error shows
      setIsInvalidOtp(true)
      setErrorMessage(message)
      logger.info('Error state after caught error:', { isInvalidOtp: true, errorMessage: message })

      // Clear the OTP input on error
      setOtp('')
    } finally {
      setIsLoading(false)
    }
  }

  function resendCode() {
    if (!email || !hasResendKey) return

    setIsLoading(true)
    setErrorMessage('')

    client.emailOtp
      .sendVerificationOtp({
        email,
        type: 'email-verification',
      })
      .then(() => {})
      .catch(() => {
        setErrorMessage('Failed to resend verification code. Please try again later.')
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
                onChange={(value) => {
                  // Only clear error when user is actively typing a new code
                  if (value.length === 6) {
                    setIsInvalidOtp(false)
                    setErrorMessage('')
                  }
                  setOtp(value)
                }}
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
    </Card>
  )
}
