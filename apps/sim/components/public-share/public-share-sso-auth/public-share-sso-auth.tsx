'use client'

import { useState } from 'react'
import { cn, Input, Label } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeEmail } from '@sim/utils/string'
import { useRouter } from 'next/navigation'
import { PublicShareAuthShell } from '@/components/public-share/public-share-auth-shell'
import type { PublicShareGateProps, PublicShareKind } from '@/components/public-share/types'
import { requestJson } from '@/lib/api/client/request'
import {
  publicFileSSOContract,
  publicInterfaceSSOContract,
} from '@/lib/api/contracts/public-shares'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AuthSubmitButton } from '@/app/(auth)/components'

const GATE_COPY = {
  file: {
    subtitle: 'This file requires SSO authentication',
    unauthorized: 'Email not authorized for this file.',
    /** Public page the SSO flow returns to once the visitor has a Sim session. */
    basePath: '/f',
  },
  interface: {
    subtitle: 'This interface requires SSO authentication',
    unauthorized: 'Email not authorized for this interface.',
    basePath: '/i',
  },
} as const satisfies Record<
  PublicShareKind,
  { subtitle: string; unauthorized: string; basePath: string }
>

/**
 * SSO gate for a protected public share: confirm the email is allow-listed,
 * then hand off to the global `/sso` flow with this share as the callback.
 * After sign-in the page gate authorizes via the Sim session — this gate never
 * mints a share auth cookie.
 */
export function PublicShareSSOAuth({ token, kind }: PublicShareGateProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const copy = GATE_COPY[kind]

  const handleAuthenticate = async () => {
    if (!quickValidateEmail(normalizeEmail(email)).isValid) {
      setError('Please enter a valid email address.')
      return
    }
    setError(null)
    setIsLoading(true)
    try {
      const normalizedEmail = normalizeEmail(email)
      const { eligible } =
        kind === 'interface'
          ? await requestJson(publicInterfaceSSOContract, {
              params: { token },
              body: { email: normalizedEmail },
            })
          : await requestJson(publicFileSSOContract, {
              params: { token },
              body: { email: normalizedEmail },
            })
      if (!eligible) {
        setError(copy.unauthorized)
        setIsLoading(false)
        return
      }
      const callbackUrl = `${copy.basePath}/${token}`
      router.push(
        `/sso?email=${encodeURIComponent(normalizedEmail)}&callbackUrl=${encodeURIComponent(callbackUrl)}`
      )
    } catch (err) {
      setError(getErrorMessage(err, copy.unauthorized))
      setIsLoading(false)
    }
  }

  return (
    <PublicShareAuthShell title='SSO Authentication' subtitle={copy.subtitle}>
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

        <AuthSubmitButton
          disabled={!email.trim()}
          loading={isLoading}
          loadingLabel='Redirecting to SSO…'
        >
          Continue with SSO
        </AuthSubmitButton>
      </form>
    </PublicShareAuthShell>
  )
}
