'use client'

import { useEffect, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Input, InputOTP, InputOTPGroup, InputOTPSlot, Label, Loader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AUTH_SUBMIT_BTN, AUTH_TEXT_LINK } from '@/app/(auth)/components/auth-button-classes'
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
  const t = useTranslations('auto')
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
    if (!quickValidateEmail(email.trim().toLowerCase()).isValid) {
      setError('Please enter a valid email address.')
      return
    }
    setError(null)
    try {
      await requestOtp.mutateAsync({ email: email.trim().toLowerCase() })
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
      await verifyOtp.mutateAsync({ email: email.trim().toLowerCase(), otp: code })
      router.refresh()
    } catch (err) {
      setError(getErrorMessage(err, 'Invalid verification code'))
    }
  }

  const resend = async () => {
    setCountdown(30)
    try {
      await requestOtp.mutateAsync({ email: email.trim().toLowerCase() })
      setOtp('')
      setError(null)
    } catch (err) {
      setCountdown(0)
      setError(getErrorMessage(err, 'Failed to resend verification code'))
    }
  }

  if (!sent) {
    return (
      <PublicFileAuthShell
        title={t('email_verification')}
        subtitle='This file requires email verification'
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendCode()
          }}
          className='space-y-6'
        >
          <div className='space-y-2'>
            <Label htmlFor='email'>{t('email')}</Label>
            <Input
              id='email'
              name='email'
              type='email'
              required
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect='off'
              placeholder={t('enter_your_email')}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setError(null)
              }}
              className={cn(error && 'border-[var(--text-error)] focus:border-[var(--text-error)]')}
            />
            {error ? <p className='text-[var(--text-error)] text-xs'>{error}</p> : null}
          </div>

          <button
            type='submit'
            disabled={!email.trim() || requestOtp.isPending}
            className={AUTH_SUBMIT_BTN}
          >
            {requestOtp.isPending ? (
              <span className='flex items-center gap-2'>
                <Loader className='size-4' animate />
                {t('sending_code')}
              </span>
            ) : (
              'Continue'
            )}
          </button>
        </form>
      </PublicFileAuthShell>
    )
  }

  return (
    <PublicFileAuthShell
      title={t('verify_your_email')}
      subtitle={`A verification code has been sent to ${email}`}
    >
      <div className='space-y-6'>
        <p className='text-center text-[var(--landing-text-muted)] text-sm'>
          {t('enter_the_6_digit_code_to')}
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

        <button
          onClick={() => verifyCode(otp)}
          disabled={otp.length !== 6 || verifyOtp.isPending}
          className={AUTH_SUBMIT_BTN}
        >
          {verifyOtp.isPending ? (
            <span className='flex items-center gap-2'>
              <Loader className='size-4' animate />
              {t('verifying')}
            </span>
          ) : (
            'Verify Email'
          )}
        </button>

        <div className='text-center'>
          <p className='text-[var(--landing-text-muted)] text-sm'>
            {t('didn_t_receive_a_code')}{' '}
            {countdown > 0 ? (
              <span>
                {t('resend_in')}{' '}
                <span className='font-medium text-[var(--landing-text)]'>{countdown}s</span>
              </span>
            ) : (
              <button
                className={AUTH_TEXT_LINK}
                onClick={resend}
                disabled={requestOtp.isPending || verifyOtp.isPending}
              >
                {t('resend')}
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
            {t('change_email')}
          </button>
        </div>
      </div>
    </PublicFileAuthShell>
  )
}
