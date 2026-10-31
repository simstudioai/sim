'use client'

import { useEffect, useState } from 'react'
import { AuthCodeEntry, AuthEmailInput, AuthField, AuthHeader, AuthStack } from '@sim/auth-ui'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AuthShell, AuthSubmitButton } from '@/app/(auth)/components'
import { useChatEmailOtpRequest, useChatEmailOtpVerify } from '@/hooks/queries/chats'

const logger = createLogger('EmailAuth')

interface EmailAuthProps {
  identifier: string
}

const validateEmailField = (emailValue: string): string[] => {
  const errors: string[] = []

  if (!emailValue || !emailValue.trim()) {
    errors.push('Email is required.')
    return errors
  }

  const validation = quickValidateEmail(emailValue.trim().toLowerCase())
  if (!validation.isValid) {
    errors.push(validation.reason || 'Please enter a valid email address.')
  }

  return errors
}

export default function EmailAuth({ identifier }: EmailAuthProps) {
  const [email, setEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const hasEmailError = emailErrors.length > 0

  const [showOtpVerification, setShowOtpVerification] = useState(false)
  const [otpValue, setOtpValue] = useState('')
  const [countdown, setCountdown] = useState(0)

  const requestOtp = useChatEmailOtpRequest(identifier)
  const verifyOtp = useChatEmailOtpVerify(identifier)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)
    setEmailErrors([])
  }

  const handleSendOtp = async () => {
    if (requestOtp.isPending || verifyOtp.isPending) return
    const emailValidationErrors = validateEmailField(email)
    setEmailErrors(emailValidationErrors)

    if (emailValidationErrors.length > 0) {
      return
    }

    setAuthError(null)

    try {
      await requestOtp.mutateAsync({ email })
      setShowOtpVerification(true)
    } catch (error) {
      logger.error('Error sending OTP:', error)
      setEmailErrors([toError(error).message || 'Failed to send verification code'])
    }
  }

  const handleVerifyOtp = async (otp?: string) => {
    if (requestOtp.isPending || verifyOtp.isPending) return
    const codeToVerify = otp || otpValue

    if (!codeToVerify || codeToVerify.length !== 6) {
      return
    }

    setAuthError(null)

    try {
      await verifyOtp.mutateAsync({ email, otp: codeToVerify })
    } catch (error) {
      logger.error('Error verifying OTP:', error)
      setAuthError(toError(error).message || 'Invalid verification code')
    }
  }

  const handleResendOtp = async () => {
    if (requestOtp.isPending || verifyOtp.isPending) return
    setAuthError(null)
    setCountdown(30)

    try {
      await requestOtp.mutateAsync({ email })
      setOtpValue('')
    } catch (error) {
      logger.error('Error resending OTP:', error)
      setAuthError(toError(error).message || 'Failed to resend verification code')
      setCountdown(0)
    }
  }

  return (
    <AuthShell>
      <AuthStack>
        <AuthHeader
          title={showOtpVerification ? 'Verify your email' : 'Email verification'}
          description={
            showOtpVerification
              ? `A verification code has been sent to ${email}`
              : 'This chat requires email verification'
          }
        />
        {!showOtpVerification ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleSendOtp()
            }}
            className='au:space-y-5'
          >
            <AuthField htmlFor='email' label='Email' errors={emailErrors}>
              <AuthEmailInput
                id='email'
                name='email'
                type='email'
                required
                value={email}
                onChange={handleEmailChange}
                error={hasEmailError}
                disabled={requestOtp.isPending}
              />
            </AuthField>
            <AuthSubmitButton loading={requestOtp.isPending} loadingLabel='Sending code…'>
              Continue
            </AuthSubmitButton>
          </form>
        ) : (
          <AuthCodeEntry
            value={otpValue}
            onChange={(value) => {
              setOtpValue(value)
              if (value.length === 6) void handleVerifyOtp(value)
            }}
            onVerify={() => {
              void handleVerifyOtp()
            }}
            onResend={() => {
              void handleResendOtp()
            }}
            onChangeEmail={() => {
              setShowOtpVerification(false)
              setOtpValue('')
              setAuthError(null)
            }}
            verifying={verifyOtp.isPending}
            resending={requestOtp.isPending}
            countdown={countdown}
            error={authError}
            help="Enter the six-digit code to verify your access. If you don't see it in your inbox, check your spam folder."
          />
        )}
      </AuthStack>
    </AuthShell>
  )
}
