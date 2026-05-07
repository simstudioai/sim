'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Loader } from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import { oauthAuthorizeParamsContract } from '@/lib/api/contracts/oauth-connections'
import { signOut, useSession } from '@/lib/auth/auth-client'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'Verify your identity',
  profile: 'Access your basic profile information',
  email: 'View your email address',
  offline_access: 'Maintain access when you are not actively using the app',
  'mcp:tools': 'Use Sim workflows and tools on your behalf',
} as const

interface ClientInfo {
  clientId: string
  name: string
  icon: string
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={null}>
      <OAuthConsentInner />
    </Suspense>
  )
}

function OAuthConsentInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const consentCode = searchParams.get('consent_code')
  const clientId = searchParams.get('client_id')
  const scope = searchParams.get('scope')

  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scopes = scope?.split(' ').filter(Boolean) ?? []

  useEffect(() => {
    if (!clientId) {
      setLoading(false)
      setError('The authorization request is missing a required client identifier.')
      return
    }

    // boundary-raw-fetch: better-auth catch-all OAuth client lookup, no app-level contract
    fetch(`/api/auth/oauth2/client/${encodeURIComponent(clientId)}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        setClientInfo(data)
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false)
      })
  }, [clientId])

  const handleConsent = useCallback(
    async (accept: boolean) => {
      if (!consentCode) {
        setError('The authorization request is missing a required consent code.')
        return
      }

      setSubmitting(true)
      try {
        // boundary-raw-fetch: better-auth catch-all OAuth consent submission, no app-level contract
        const res = await fetch('/api/auth/oauth2/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accept, consent_code: consentCode }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => null)
          setError(
            (body as Record<string, string> | null)?.message ??
              'The consent request could not be processed. Please try again.'
          )
          setSubmitting(false)
          return
        }

        const data = (await res.json()) as { redirectURI?: string }
        if (data.redirectURI) {
          window.location.href = data.redirectURI
        } else {
          setError('The server did not return a redirect. Please try again.')
          setSubmitting(false)
        }
      } catch {
        setError('Something went wrong. Please try again.')
        setSubmitting(false)
      }
    },
    [consentCode]
  )

  const handleSwitchAccount = useCallback(async () => {
    if (!consentCode) return

    const params = await requestJson(oauthAuthorizeParamsContract, {
      query: { consent_code: consentCode },
    }).catch(() => null)

    if (!params) {
      setError('Unable to switch accounts. Please re-initiate the connection.')
      return
    }

    const authorizeUrl = new URL('/api/auth/oauth2/authorize', window.location.origin)
    for (const [key, value] of Object.entries(params)) {
      if (value) authorizeUrl.searchParams.set(key, value)
    }

    await signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = authorizeUrl.toString()
        },
      },
    })
  }, [consentCode])

  if (loading) {
    return (
      <div className='flex flex-col items-center justify-center'>
        <div className='space-y-1 text-center'>
          <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
            Authorize Application
          </h1>
          <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
            Loading application details...
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex flex-col items-center justify-center'>
        <div className='space-y-1 text-center'>
          <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
            Authorization Error
          </h1>
          <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
            {error}
          </p>
        </div>
        <div className='mt-8 w-full max-w-[410px] space-y-3'>
          <button onClick={() => router.push('/')} className={AUTH_SUBMIT_BTN}>
            Return to Home
          </button>
        </div>
      </div>
    )
  }

  const clientName = clientInfo?.name ?? clientId

  return (
    <div className='flex flex-col items-center justify-center'>
      <div className='mb-6 flex items-center gap-4'>
        {clientInfo?.icon ? (
          <img
            src={clientInfo.icon}
            alt={clientName ?? 'Application'}
            width={48}
            height={48}
            className='rounded-[10px]'
          />
        ) : (
          <div className='flex h-12 w-12 items-center justify-center rounded-[10px] bg-[var(--landing-bg-elevated)] font-medium text-[var(--landing-text-muted)] text-lg'>
            {(clientName ?? '?').charAt(0).toUpperCase()}
          </div>
        )}
        <ArrowLeftRight className='h-5 w-5 text-[var(--landing-text-muted)]' />
        <Image
          src='/new/logo/colorized-bg.svg'
          alt='Sim'
          width={48}
          height={48}
          className='rounded-[10px]'
        />
      </div>

      <div className='space-y-1 text-center'>
        <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
          Authorize Application
        </h1>
        <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
          <span className='font-medium text-[var(--landing-text)]'>{clientName}</span> is requesting
          access to your account
        </p>
      </div>

      {session?.user && (
        <div className='mt-5 flex items-center gap-3 rounded-lg border border-[var(--landing-bg-elevated)] px-4 py-3'>
          {session.user.image ? (
            <Image
              src={session.user.image}
              alt={session.user.name ?? 'User'}
              width={32}
              height={32}
              className='rounded-full'
              unoptimized
            />
          ) : (
            <div className='flex h-8 w-8 items-center justify-center rounded-full bg-[var(--landing-bg-elevated)] font-medium text-[var(--landing-text-muted)] text-small'>
              {(session.user.name ?? session.user.email ?? '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className='min-w-0'>
            {session.user.name && (
              <p className='truncate font-medium text-sm'>{session.user.name}</p>
            )}
            <p className='truncate text-[var(--landing-text-muted)] text-small'>
              {session.user.email}
            </p>
          </div>
          <button
            type='button'
            onClick={handleSwitchAccount}
            className='ml-auto text-[var(--landing-text-muted)] text-small underline-offset-2 transition-colors hover:text-[var(--landing-text)] hover:underline'
          >
            Switch
          </button>
        </div>
      )}

      {scopes.length > 0 && (
        <div className='mt-5 w-full max-w-[410px]'>
          <div className='rounded-lg border border-[var(--landing-bg-elevated)] p-4'>
            <p className='mb-3 font-medium text-sm'>This will allow the application to:</p>
            <ul className='space-y-2'>
              {scopes.map((s) => (
                <li
                  key={s}
                  className='flex items-start gap-2 font-normal text-[var(--landing-text-muted)] text-small'
                >
                  <span className='mt-0.5 text-green-500'>&#10003;</span>
                  <span>{SCOPE_DESCRIPTIONS[s] ?? s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className='mt-6 flex w-full max-w-[410px] gap-3'>
        <Button
          variant='outline'
          size='md'
          className='px-6 py-2'
          disabled={submitting}
          onClick={() => handleConsent(false)}
        >
          Deny
        </Button>
        <button
          onClick={() => handleConsent(true)}
          disabled={submitting}
          className={AUTH_SUBMIT_BTN}
        >
          {submitting ? (
            <span className='flex items-center gap-2'>
              <Loader className='h-4 w-4' animate />
              Authorizing...
            </span>
          ) : (
            'Allow'
          )}
        </button>
      </div>
    </div>
  )
}
