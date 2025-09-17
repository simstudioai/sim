'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'

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

export function useVerification({
  hasResendKey,
  isProduction,
}: UseVerificationParams): UseVerificationReturn {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refetch: refetchSession } = useSession()
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [isSendingInitialOtp, setIsSendingInitialOtp] = useState(false)
  const [isInvalidOtp, setIsInvalidOtp] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null)
  const [isInviteFlow, setIsInviteFlow] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Get stored email
      const storedEmail = sessionStorage.getItem('verificationEmail')
      if (storedEmail) {
        setEmail(storedEmail)
      }

      // Check for redirect information
      const storedRedirectUrl = sessionStorage.getItem('inviteRedirectUrl')
      if (storedRedirectUrl) {
        setRedirectUrl(storedRedirectUrl)
      }

      // Check if this is an invite flow
      const storedIsInviteFlow = sessionStorage.getItem('isInviteFlow')
      if (storedIsInviteFlow === 'true') {
        setIsInviteFlow(true)
      }
    }

    // Also check URL parameters for redirect information
    const redirectParam = searchParams.get('redirectAfter')
    if (redirectParam) {
      setRedirectUrl(redirectParam)
    }

    // Check for invite_flow parameter
    const inviteFlowParam = searchParams.get('invite_flow')
    if (inviteFlowParam === 'true') {
      setIsInviteFlow(true)
    }
  }, [searchParams])

  // Do not auto-send OTP on mount; allow user to trigger resend explicitly
  useEffect(() => {
    if (email && !isSendingInitialOtp && hasResendKey) {
      setIsSendingInitialOtp(true)
    }
  }, [email, isSendingInitialOtp, hasResendKey])

  // Enable the verify button when all 6 digits are entered
  const isOtpComplete = otp.length === 6

  async function verifyCode() {
    if (!isOtpComplete || !email) return

    setIsLoading(true)
    setIsInvalidOtp(false)
    setErrorMessage('')

    try {
      // Normalize email before verifying
      const normalizedEmail = email.trim().toLowerCase()
      // Use sign-in OTP verification to create a session directly
      const response = await client.signIn.emailOtp({
        email: normalizedEmail,
        otp,
      })

      // Check if verification was successful
      if (response && !response.error) {
        setIsVerified(true)

        // Refresh session after verification to avoid redirect bounce
        try {
          await refetchSession()
        } catch (e) {
          logger.warn('Failed to refetch session after verification', e)
        }

        // Clear verification requirements and session storage
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('verificationEmail')

          // Also clear invite-related items
          if (isInviteFlow) {
            sessionStorage.removeItem('inviteRedirectUrl')
            sessionStorage.removeItem('isInviteFlow')
          }
        }

        setTimeout(() => {
          if (isInviteFlow && redirectUrl) {
            // For invitation flow, redirect to the invitation page
            window.location.href = redirectUrl
          } else {
            // Default redirect to dashboard
            window.location.href = '/workspace'
          }
        }, 1000)
      } else {
        logger.info('Setting invalid OTP state - API error response')
        const message = 'Invalid verification code. Please check and try again.'
        // Set both state variables to ensure the error shows
        setIsInvalidOtp(true)
        setErrorMessage(message)
        logger.info('Error state after API error:', {
          isInvalidOtp: true,
          errorMessage: message,
        })
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
      logger.info('Error state after caught error:', {
        isInvalidOtp: true,
        errorMessage: message,
      })

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

    const normalizedEmail = email.trim().toLowerCase()
    client.emailOtp
      .sendVerificationOtp({
        email: normalizedEmail,
        type: 'sign-in',
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

  // Auto-submit when OTP is complete
  useEffect(() => {
    if (otp.length === 6 && email && !isLoading && !isVerified) {
      const timeoutId = setTimeout(() => {
        verifyCode()
      }, 300) // Small delay to ensure UI is ready

      return () => clearTimeout(timeoutId)
    }
  }, [otp, email, isLoading, isVerified])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Dev-only skip (do not skip in production even if running in Docker)
      if (!isProduction || !hasResendKey) {
        setIsVerified(true)

        const timeoutId = setTimeout(() => {
          window.location.href = '/workspace'
        }, 1000)

        return () => clearTimeout(timeoutId)
      }
    }
  }, [isProduction, hasResendKey, router])

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
    handleOtpChange,
  }
}
