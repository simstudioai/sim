'use client'

import { useEffect, useState } from 'react'
import { cn, Input, InputOTP, InputOTPGroup, InputOTPSlot, Label } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeEmail } from '@sim/utils/string'
import { useRouter } from 'next/navigation'
import { PublicShareAuthShell } from '@/components/public-share/public-share-auth-shell'
import type { PublicShareGateProps, PublicShareKind } from '@/components/public-share/types'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AuthSubmitButton } from '@/app/(auth)/components'
import { AUTH_TEXT_LINK } from '@/app/(auth)/components/auth-button-classes'
import {
  usePublicInterfaceOtpRequest,
  usePublicInterfaceOtpVerify,
} from '@/hooks/queries/public-interface-shares'
import { usePublicFileOtpRequest, usePublicFileOtpVerify } from '@/hooks/queries/public-shares'

const RESEND_COUNTDOWN_SECONDS = 30

const GATE_COPY = {
  file: {
    requestTitle: 'Email Verification',
    requestSubtitle: 'This file requires email verification',
  },
  interface: {
    requestTitle: 'Email Verification',
    requestSubtitle: 'This interface requires email verification',
  },
} as const satisfies Record<PublicShareKind, { requestTitle: string; requestSubtitle: string }>

/**
 * Email-OTP gate for a protected public share: collect an allow-listed email,
 * send a 6-digit code, verify it. On success the server sets the
 * `{kind}_auth_{shareId}` cookie and the page re-renders the resource.
 *
 * Both hook pairs are instantiated unconditionally — `useMutation` performs no
 * work until it is called, and hooks may not be called conditionally — then one
 * pair is selected by `kind`.
 */
export function PublicShareEmailAuth({ token, kind }: PublicShareGateProps) {
  const router = useRouter()
  const fileRequestOtp = usePublicFileOtpRequest(token)
  const fileVerifyOtp = usePublicFileOtpVerify(token)
  const interfaceRequestOtp = usePublicInterfaceOtpRequest(token)
  const interfaceVerifyOtp = usePublicInterfaceOtpVerify(token)

  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)

  const copy = GATE_COPY[kind]
  const isInterface = kind === 'interface'
  const requestOtp = isInterface ? interfaceRequestOtp : fileRequestOtp
  const verifyOtp = isInterface ? interfaceVerifyOtp : fileVerifyOtp

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const sendCode = async () => {
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
    setCountdown(RESEND_COUNTDOWN_SECONDS)
    try {
      await requestOtp.mutateAsync({ email: normalizeEmail(email) })
      setOtp('')
      setError(null)
    } catch (err) {
      setCountdown(0)
      setError(getErrorMessage(err, 'Failed to resend verification code'))
    }
  }

  if (!sent) {
    return (
      <PublicShareAuthShell title={copy.requestTitle} subtitle={copy.requestSubtitle}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendCode()
          }}
          className='space-y-6'
        >
          <div className='space-y-2'>
            <Label htmlFor='email'>Email</Label>
            <Input
              id='email'
              name='email'
              type='email'
              required
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect='off'
              placeholder='Enter your email'
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setError(null)
              }}
              className={cn(error && 'border-[var(--text-error)] focus:border-[var(--text-error)]')}
            />
            {error ? <p className='text-[var(--text-error)] text-xs'>{error}</p> : null}
          </div>

          <AuthSubmitButton
            disabled={!email.trim()}
            loading={requestOtp.isPending}
            loadingLabel='Sending Code…'
          >
            Continue
          </AuthSubmitButton>
        </form>
      </PublicShareAuthShell>
    )
  }

  return (
    <PublicShareAuthShell
      title='Verify Your Email'
      subtitle={`A verification code has been sent to ${email}`}
    >
      <div className='space-y-6'>
        <p className='text-center text-[var(--text-muted)] text-sm'>
          Enter the 6-digit code to verify your access. If you don't see it in your inbox, check
          your spam folder.
        </p>

        <div className='flex justify-center'>
          <InputOTP
            maxLength={6}
            value={otp}
            onChange={(value) => {
              setOtp(value)
              setError(null)
              if (value.length === 6) verifyCode(value)
            }}
            disabled={verifyOtp.isPending}
            className={cn('gap-2', error && 'otp-error')}
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className={cn(error && 'border-[var(--text-error)]')}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        {error ? <p className='text-center text-[var(--text-error)] text-xs'>{error}</p> : null}

        <AuthSubmitButton
          type='button'
          onClick={() => verifyCode(otp)}
          disabled={otp.length !== 6}
          loading={verifyOtp.isPending}
          loadingLabel='Verifying…'
        >
          Verify Email
        </AuthSubmitButton>

        <div className='text-center'>
          <p className='text-[var(--text-muted)] text-sm'>
            Didn't receive a code?{' '}
            {countdown > 0 ? (
              <span>
                Resend in{' '}
                <span className='font-medium text-[var(--text-primary)]'>{countdown}s</span>
              </span>
            ) : (
              <button
                className={AUTH_TEXT_LINK}
                onClick={resend}
                disabled={requestOtp.isPending || verifyOtp.isPending}
              >
                Resend
              </button>
            )}
          </p>
        </div>

        <div className='text-center font-light text-sm'>
          <button
            onClick={() => {
              setSent(false)
              setOtp('')
              setError(null)
            }}
            className={AUTH_TEXT_LINK}
          >
            Change email
          </button>
        </div>
      </div>
    </PublicShareAuthShell>
  )
}
