'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import { signOut, useSession } from '@/lib/auth/auth-client'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import { BrandedButton } from '@/app/(auth)/components/branded-button'

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

    fetch(`/api/auth/oauth2/client/${clientId}`, { credentials: 'include' })
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
        }
      } catch {
        setError('Something went wrong. Please try again.')
        setSubmitting(false)
      }
    },
    [consentCode]
  )

  const handleSwitchAccount = useCallback(async () => {
    const currentUrl = window.location.href
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = `/login?callbackUrl=${encodeURIComponent(currentUrl)}`
        },
      },
    })
  }, [])

  if (loading) {
    return (
      <div className='flex flex-col items-center justify-center'>
        <div className='space-y-1 text-center'>
          <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
            Authorize Application
          </h1>
          <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
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
          <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
            Authorization Error
          </h1>
          <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
            {error}
          </p>
        </div>
        <div className={`${inter.className} mt-8 w-full max-w-[410px] space-y-3`}>
          <BrandedButton onClick={() => router.push('/')}>Return to Home</BrandedButton>
        </div>
      </div>
    )
  }

  const clientName = clientInfo?.name ?? clientId

  return (
    <div className='flex flex-col items-center justify-center'>
      <div className='mb-6 flex items-center gap-4'>
        {clientInfo?.icon ? (
          <Image
            src={clientInfo.icon}
            alt={clientName ?? 'Application'}
            width={48}
            height={48}
            className='rounded-[10px]'
            unoptimized
          />
        ) : (
          <div className='flex h-12 w-12 items-center justify-center rounded-[10px] bg-muted font-medium text-[18px] text-muted-foreground'>
            {(clientName ?? '?').charAt(0).toUpperCase()}
          </div>
        )}
        <ArrowLeftRight className='h-5 w-5 text-muted-foreground' />
        <Image
          src='/new/logo/colorized-bg.svg'
          alt='Sim'
          width={48}
          height={48}
          className='rounded-[10px]'
        />
      </div>

      <div className='space-y-1 text-center'>
        <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
          Authorize Application
        </h1>
        <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
          <span className='font-medium text-foreground'>{clientName}</span> is requesting access to
          your account
        </p>
      </div>

      {session?.user && (
        <div
          className={`${inter.className} mt-5 flex items-center gap-3 rounded-lg border px-4 py-3`}
        >
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
            <div className='flex h-8 w-8 items-center justify-center rounded-full bg-muted font-medium text-[13px] text-muted-foreground'>
              {(session.user.name ?? session.user.email ?? '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className='min-w-0'>
            {session.user.name && (
              <p className='truncate font-medium text-[14px]'>{session.user.name}</p>
            )}
            <p className='truncate text-[13px] text-muted-foreground'>{session.user.email}</p>
          </div>
          <button
            type='button'
            onClick={handleSwitchAccount}
            className='ml-auto text-[13px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline'
          >
            Switch
          </button>
        </div>
      )}

      {scopes.length > 0 && (
        <div className={`${inter.className} mt-5 w-full max-w-[410px]`}>
          <div className='rounded-lg border p-4'>
            <p className='mb-3 font-medium text-[14px]'>This will allow the application to:</p>
            <ul className='space-y-2'>
              {scopes.map((s) => (
                <li
                  key={s}
                  className='flex items-start gap-2 font-normal text-[13px] text-muted-foreground'
                >
                  <span className='mt-0.5 text-green-500'>&#10003;</span>
                  <span>{SCOPE_DESCRIPTIONS[s] ?? s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className={`${inter.className} mt-6 flex w-full max-w-[410px] gap-3`}>
        <Button
          variant='outline'
          size='md'
          className='px-6 py-2'
          disabled={submitting}
          onClick={() => handleConsent(false)}
        >
          Deny
        </Button>
        <BrandedButton
          fullWidth
          showArrow={false}
          loading={submitting}
          loadingText='Authorizing'
          onClick={() => handleConsent(true)}
        >
          Allow
        </BrandedButton>
      </div>
    </div>
  )
}
