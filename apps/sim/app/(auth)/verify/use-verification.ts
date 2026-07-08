'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import { useRouter, useSearchParams } from 'next/navigation'
import { client, useSession } from '@/lib/auth/auth-client'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'

const logger = createLogger('useVerification')

/**
 * Mutually-exclusive phases of the email-OTP verification machine.
 * - `idle`: awaiting input
 * - `verifying`: a verify request is in flight
 * - `verified`: code accepted, redirecting
 * - `error`: last verify attempt failed (paired with `errorMessage`)
 */
type VerificationStatus = 'idle' | 'verifying' | 'verified' | 'error'

interface UseVerificationParams {
  hasEmailService: boolean
  isProduction: boolean
  isEmailVerificationEnabled: boolean
}

interface UseVerificationReturn {
  otp: string
  email: string
  status: VerificationStatus
  isResending: boolean
  errorMessage: string
  isOtpComplete: boolean
  hasEmailService: boolean
  isProduction: boolean
  isEmailVerificationEnabled: boolean
  verifyCode: () => Promise<void>
  resendCode: () => void
  handleOtpChange: (value: string) => void
}

export function useVerification({
  hasEmailService,
  isProduction,
  isEmailVerificationEnabled,
}: UseVerificationParams): UseVerificationReturn {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refetch: refetchSession } = useSession()
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<VerificationStatus>('idle')
  const [isResending, setIsResending] = useState(false)
  const [isSendingInitialOtp, setIsSendingInitialOtp] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null)
  const [isInviteFlow, setIsInviteFlow] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedEmail = sessionStorage.getItem('verificationEmail')
      if (storedEmail) {
        setEmail(storedEmail)
      }

      const storedRedirectUrl = sessionStorage.getItem('inviteRedirectUrl')
      if (storedRedirectUrl && validateCallbackUrl(storedRedirectUrl)) {
        setRedirectUrl(storedRedirectUrl)
      } else if (storedRedirectUrl) {
        logger.warn('Ignoring unsafe stored invite redirect URL', { url: storedRedirectUrl })
        sessionStorage.removeItem('inviteRedirectUrl')
      }

      const storedIsInviteFlow = sessionStorage.getItem('isInviteFlow')
      if (storedIsInviteFlow === 'true') {
        setIsInviteFlow(true)
      }
    }

    const redirectParam = searchParams.get('redirectAfter')
    if (redirectParam) {
      if (validateCallbackUrl(redirectParam)) {
        setRedirectUrl(redirectParam)
      } else {
        logger.warn('Ignoring unsafe redirectAfter parameter', { url: redirectParam })
      }
    }

    const inviteFlowParam = searchParams.get('invite_flow')
    if (inviteFlowParam === 'true') {
      setIsInviteFlow(true)
    }
  }, [searchParams])

  useEffect(() => {
    if (email && !isSendingInitialOtp && hasEmailService) {
      setIsSendingInitialOtp(true)
    }
  }, [email, isSendingInitialOtp, hasEmailService])

  const isOtpComplete = otp.length === 6

  async function verifyCode() {
    if (!isOtpComplete || !email) return

    setStatus('verifying')
    setErrorMessage('')

    try {
      const normalizedEmail = normalizeEmail(email)
      const response = await client.emailOtp.verifyEmail({
        email: normalizedEmail,
        otp,
      })

      if (response && !response.error) {
        setStatus('verified')

        try {
          await refetchSession()
        } catch (e) {
          logger.warn('Failed to refetch session after verification', e)
        }

        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('verificationEmail')

          if (isInviteFlow) {
            sessionStorage.removeItem('inviteRedirectUrl')
            sessionStorage.removeItem('isInviteFlow')
          }
        }

        setTimeout(() => {
          if (isInviteFlow && redirectUrl) {
            window.location.href = redirectUrl
          } else {
            window.location.href = '/workspace'
          }
        }, 1000)
      } else {
        logger.info('Setting invalid OTP state - API error response')
        const message = 'Invalid verification code. Please check and try again.'
        setStatus('error')
        setErrorMessage(message)
        logger.info('Error state after API error:', { errorMessage: message })
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

      setStatus('error')
      setErrorMessage(message)
      logger.info('Error state after caught error:', { errorMessage: message })

      setOtp('')
    }
  }

  function resendCode() {
    if (!email || !hasEmailService || !isEmailVerificationEnabled) return

    setIsResending(true)
    setErrorMessage('')

    const normalizedEmail = normalizeEmail(email)
    client.emailOtp
      .sendVerificationOtp({
        email: normalizedEmail,
        type: 'email-verification',
      })
      .then(() => {})
      .catch(() => {
        setErrorMessage('Failed to resend verification code. Please try again later.')
      })
      .finally(() => {
        setIsResending(false)
      })
  }

  /**
   * On a complete (6-char) code, clear any lingering message — including a
   * resend failure (which sets `errorMessage` while `status` stays `idle`) — and
   * exit the error state, matching the prior unconditional reset on a full OTP.
   */
  function handleOtpChange(value: string) {
    if (value.length === 6) {
      if (status === 'error') setStatus('idle')
      setErrorMessage('')
    }
    setOtp(value)
  }

  useEffect(() => {
    if (
      otp.length === 6 &&
      email &&
      status !== 'verifying' &&
      status !== 'verified' &&
      !isResending
    ) {
      const timeoutId = setTimeout(() => {
        verifyCode()
      }, 300)

      return () => clearTimeout(timeoutId)
    }
  }, [otp, email, status, isResending])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (!isEmailVerificationEnabled) {
        setStatus('verified')

        const handleRedirect = async () => {
          try {
            await refetchSession()
          } catch (error) {
            logger.warn('Failed to refetch session during verification skip:', error)
          }

          if (isInviteFlow && redirectUrl) {
            window.location.href = redirectUrl
          } else {
            router.push('/workspace')
          }
        }

        handleRedirect()
      }
    }
  }, [isEmailVerificationEnabled, router, isInviteFlow, redirectUrl])

  return {
    otp,
    email,
    status,
    isResending,
    errorMessage,
    isOtpComplete,
    hasEmailService,
    isProduction,
    isEmailVerificationEnabled,
    verifyCode,
    resendCode,
    handleOtpChange,
  }
}
