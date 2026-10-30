'use client'

import { useEffect, useState } from 'react'
import { AuthCodeEntry, AuthField, AuthInput } from '@sim/auth-ui'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeEmail } from '@sim/utils/string'
import { useRouter } from 'next/navigation'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AuthSubmitButton } from '@/app/(auth)/components'
import { PublicFileAuthShell } from '@/app/f/[token]/public-file-auth-shell'
import { usePublicFileOtpRequest, usePublicFileOtpVerify } from '@/hooks/queries/public-shares'

interface PublicFileEmailAuthProps {
  token: string
}

/**
 * Email-OTP gate for a protected public file share: collect an allow-listed email,
 * send a 6-digit code, verify it. On success the server sets the
 * `file_auth_{shareId}` cookie and the page re-renders the viewer.
 */
export function PublicFileEmailAuth({ token }: PublicFileEmailAuthProps) {
  const router = useRouter()
  const requestOtp = usePublicFileOtpRequest(token)
  const verifyOtp = usePublicFileOtpVerify(token)

  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const sendCode = async () => {
    if (requestOtp.isPending || verifyOtp.isPending) return
    if (!quickValidateEmail(normalizeEmail(email)).isValid) {
      setError('Please enter a valid email address.')
      return
    }
    setError(null)
    try {
      await requestOtp.mutateAsync({ email: normalizeEmail(email) })
      setSent(true)
      setOtp('')
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to send verification code'))
    }
  }

  const verifyCode = async (code: string) => {
    if (requestOtp.isPending || verifyOtp.isPending) return
    if (code.length !== 6) return
    setError(null)
    try {
      await verifyOtp.mutateAsync({ email: normalizeEmail(email), otp: code })
      router.refresh()
    } catch (err) {
      setError(getErrorMessage(err, 'Invalid verification code'))
    }
  }

  const resend = async () => {
    if (requestOtp.isPending || verifyOtp.isPending) return
    setCountdown(30)
    try {
      await requestOtp.mutateAsync({ email: normalizeEmail(email) })
      setOtp('')
      setError(null)
    } catch (err) {
      setCountdown(0)
      setError(getErrorMessage(err, 'Failed to resend verification code'))
    }
  }

  return (
    <PublicFileAuthShell
      title={sent ? 'Verify your email' : 'Email verification'}
      subtitle={
        sent
          ? `A verification code has been sent to ${email}`
          : 'This file requires email verification'
      }
    >
      {!sent ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void sendCode()
          }}
          className='au:space-y-5'
        >
          <AuthField htmlFor='email' label='Email' errors={error ? [error] : undefined}>
            <AuthInput
              id='email'
              name='email'
              type='email'
              required
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect='off'
              placeholder='Enter your email'
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setError(null)
              }}
              error={Boolean(error)}
              disabled={requestOtp.isPending}
            />
          </AuthField>
          <AuthSubmitButton
            disabled={!email.trim()}
            loading={requestOtp.isPending}
            loadingLabel='Sending code…'
          >
            Continue
          </AuthSubmitButton>
        </form>
      ) : (
        <AuthCodeEntry
          value={otp}
          onChange={(value) => {
            setOtp(value)
            setError(null)
            if (value.length === 6) void verifyCode(value)
          }}
          onVerify={() => {
            void verifyCode(otp)
          }}
          onResend={() => {
            void resend()
          }}
          onChangeEmail={() => {
            setSent(false)
            setOtp('')
            setError(null)
          }}
          verifying={verifyOtp.isPending}
          resending={requestOtp.isPending}
          countdown={countdown}
          error={error}
          help="Enter the six-digit code to verify your access. If you don't see it in your inbox, check your spam folder."
        />
      )}
    </PublicFileAuthShell>
  )
}
