'use client'

import { useState } from 'react'
import { cn, Input, Label, Loader } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { publicFileSSOContract } from '@/lib/api/contracts/public-shares'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { PublicFileAuthShell } from '@/app/f/[token]/public-file-auth-shell'

interface PublicFileSSOAuthProps {
  token: string
}

/**
 * SSO gate for a protected public file share: confirm the email is allow-listed,
 * then hand off to the global `/sso` flow with this share as the callback. After
 * sign-in the page gate authorizes via the Sim session.
 */
export function PublicFileSSOAuth({ token }: PublicFileSSOAuthProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleAuthenticate = async () => {
    if (!quickValidateEmail(email.trim().toLowerCase()).isValid) {
      setError('Please enter a valid email address.')
      return
    }
    setError(null)
    setIsLoading(true)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const { eligible } = await requestJson(publicFileSSOContract, {
        params: { token },
        body: { email: normalizedEmail },
      })
      if (!eligible) {
        setError('Email not authorized for this file.')
        setIsLoading(false)
        return
      }
      const callbackUrl = `/f/${token}`
      router.push(
        `/sso?email=${encodeURIComponent(normalizedEmail)}&callbackUrl=${encodeURIComponent(callbackUrl)}`
      )
    } catch (err) {
      setError(getErrorMessage(err, 'Email not authorized for this file.'))
      setIsLoading(false)
    }
  }

  return (
    <PublicFileAuthShell
      title='SSO Authentication'
      subtitle='This file requires SSO authentication'
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleAuthenticate()
        }}
        className='space-y-6'
      >
        <div className='space-y-2'>
          <Label htmlFor='email'>Work Email</Label>
          <Input
            id='email'
            name='email'
            required
            type='email'
            autoCapitalize='none'
            autoComplete='email'
            autoCorrect='off'
            placeholder='Enter your work email'
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            className={cn(error && 'border-[var(--text-error)] focus:border-[var(--text-error)]')}
          />
          {error ? <p className='text-[var(--text-error)] text-xs'>{error}</p> : null}
        </div>

        <button type='submit' disabled={!email.trim() || isLoading} className={AUTH_SUBMIT_BTN}>
          {isLoading ? (
            <span className='flex items-center gap-2'>
              <Loader className='size-4' animate />
              Redirecting to SSO…
            </span>
          ) : (
            'Continue with SSO'
          )}
        </button>
      </form>
    </PublicFileAuthShell>
  )
}
