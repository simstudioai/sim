'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { useNotificationStore } from '@/stores/notifications/store'

const logger = createLogger('useVerification')

interface UseVerificationParams {
  hasResendKey: boolean
  isProduction: boolean
}

interface UseVerificationReturn {
  otp: string
  email: string
  isLoading: boolean
  isVerified: boolean
  isInvalidOtp: boolean
  errorMessage: string
  isOtpComplete: boolean
  hasResendKey: boolean
  isProduction: boolean
  verifyCode: () => Promise<void>
  resendCode: () => void
  handleOtpChange: (value: string) => void
}

export function useVerification({ hasResendKey, isProduction }: UseVerificationParams): UseVerificationReturn {
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

  function handleOtpChange(value: string) {
    // Only clear error when user is actively typing a new code
    if (value.length === 6) {
      setIsInvalidOtp(false)
      setErrorMessage('')
    }
    setOtp(value)
  }

  return {
    otp,
    email,
    isLoading,
    isVerified,
    isInvalidOtp,
    errorMessage,
    isOtpComplete,
    hasResendKey,
    isProduction,
    verifyCode,
    resendCode,
    handleOtpChange
  }
} 