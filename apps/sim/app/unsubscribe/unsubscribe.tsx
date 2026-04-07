'use client'

import { Suspense, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { InviteLayout } from '@/app/invite/components'

interface UnsubscribeData {
  success: boolean
  email: string
  token: string
  emailType: string
  isTransactional: boolean
  currentPreferences: {
    unsubscribeAll?: boolean
    unsubscribeMarketing?: boolean
    unsubscribeUpdates?: boolean
    unsubscribeNotifications?: boolean
  }
}

function UnsubscribeContent() {
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<UnsubscribeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [unsubscribed, setUnsubscribed] = useState(false)

  const email = searchParams.get('email')
  const token = searchParams.get('token')

  useEffect(() => {
    if (!email || !token) {
      setError('Missing email or token in URL')
      setLoading(false)
      return
    }

    fetch(
      `/api/users/me/settings/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setData(data)
        } else {
          setError(data.error || 'Invalid unsubscribe link')
        }
      })
      .catch(() => {
        setError('Failed to validate unsubscribe link')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [email, token])

  const handleUnsubscribe = async (type: 'all' | 'marketing' | 'updates' | 'notifications') => {
    if (!email || !token) return

    setProcessing(true)

    try {
      const response = await fetch('/api/users/me/settings/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          token,
          type,
        }),
      })

      const result = await response.json()

      if (result.success) {
        setUnsubscribed(true)
        if (data) {
          const validTypes = ['all', 'marketing', 'updates', 'notifications'] as const
          if (validTypes.includes(type)) {
            if (type === 'all') {
              setData({
                ...data,
                currentPreferences: {
                  ...data.currentPreferences,
                  unsubscribeAll: true,
                },
              })
            } else {
              const propertyKey = `unsubscribe${type.charAt(0).toUpperCase()}${type.slice(1)}` as
                | 'unsubscribeMarketing'
                | 'unsubscribeUpdates'
                | 'unsubscribeNotifications'
              setData({
                ...data,
                currentPreferences: {
                  ...data.currentPreferences,
                  [propertyKey]: true,
                },
              })
            }
          }
        }
      } else {
        setError(result.error || 'Failed to unsubscribe')
      }
    } catch {
      setError('Failed to process unsubscribe request')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <InviteLayout>
        <div className='space-y-1 text-center'>
          <h1 className={'font-medium text-[32px] text-[var(--landing-text)] tracking-tight'}>
            Loading
          </h1>
          <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
            Validating your unsubscribe link...
          </p>
        </div>
        <div className={'mt-8 flex w-full items-center justify-center py-8'}>
          <Loader2 className='h-8 w-8 animate-spin text-[var(--landing-text-muted)]' />
        </div>
      </InviteLayout>
    )
  }

  if (error) {
    return (
      <InviteLayout>
        <div className='space-y-1 text-center'>
          <h1 className={'font-medium text-[32px] text-[var(--landing-text)] tracking-tight'}>
            Invalid Unsubscribe Link
          </h1>
          <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>{error}</p>
        </div>

        <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
          <button onClick={() => window.history.back()} className={AUTH_SUBMIT_BTN}>
            Go Back
          </button>
        </div>
      </InviteLayout>
    )
  }

  if (data?.isTransactional) {
    return (
      <InviteLayout>
        <div className='space-y-1 text-center'>
          <h1 className={'font-medium text-[32px] text-[var(--landing-text)] tracking-tight'}>
            Important Account Emails
          </h1>
          <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
            Transactional emails like password resets, account confirmations, and security alerts
            cannot be unsubscribed from as they contain essential information for your account.
          </p>
        </div>

        <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
          <button onClick={() => window.close()} className={AUTH_SUBMIT_BTN}>
            Close
          </button>
        </div>
      </InviteLayout>
    )
  }

  if (unsubscribed) {
    return (
      <InviteLayout>
        <div className='space-y-1 text-center'>
          <h1 className={'font-medium text-[32px] text-[var(--landing-text)] tracking-tight'}>
            Successfully Unsubscribed
          </h1>
          <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
            You have been unsubscribed from our emails. You will stop receiving emails within 48
            hours.
          </p>
        </div>

        <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
          <button onClick={() => window.close()} className={AUTH_SUBMIT_BTN}>
            Close
          </button>
        </div>
      </InviteLayout>
    )
  }

  const isAlreadyUnsubscribedFromAll = data?.currentPreferences.unsubscribeAll

  return (
    <InviteLayout>
      <div className='space-y-1 text-center'>
        <h1 className={'font-medium text-[32px] text-[var(--landing-text)] tracking-tight'}>
          Email Preferences
        </h1>
        <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
          Choose which emails you'd like to stop receiving.
        </p>
        <p className={'mt-2 font-[380] text-[var(--landing-text-muted)] text-sm'}>{data?.email}</p>
      </div>

      <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
        <button
          onClick={() => handleUnsubscribe('all')}
          disabled={processing || isAlreadyUnsubscribedFromAll}
          className={AUTH_SUBMIT_BTN}
        >
          {processing ? (
            <span className='flex items-center gap-2'>
              <Loader2 className='h-4 w-4 animate-spin' />
              Unsubscribing...
            </span>
          ) : isAlreadyUnsubscribedFromAll ? (
            'Unsubscribed from All Emails'
          ) : (
            'Unsubscribe from All Marketing Emails'
          )}
        </button>

        <div className='py-2 text-center'>
          <span className={'font-[380] text-[var(--landing-text-muted)] text-sm'}>
            or choose specific types
          </span>
        </div>

        <button
          onClick={() => handleUnsubscribe('marketing')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeMarketing
          }
          className={AUTH_SUBMIT_BTN}
        >
          {data?.currentPreferences.unsubscribeMarketing
            ? 'Unsubscribed from Marketing'
            : 'Unsubscribe from Marketing Emails'}
        </button>

        <button
          onClick={() => handleUnsubscribe('updates')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeUpdates
          }
          className={AUTH_SUBMIT_BTN}
        >
          {data?.currentPreferences.unsubscribeUpdates
            ? 'Unsubscribed from Updates'
            : 'Unsubscribe from Product Updates'}
        </button>

        <button
          onClick={() => handleUnsubscribe('notifications')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeNotifications
          }
          className={AUTH_SUBMIT_BTN}
        >
          {data?.currentPreferences.unsubscribeNotifications
            ? 'Unsubscribed from Notifications'
            : 'Unsubscribe from Notifications'}
        </button>
      </div>

      <div className={'mt-6 max-w-[410px] text-center'}>
        <p className='font-[380] text-[var(--landing-text-muted)] text-small'>
          You'll continue receiving important account emails like password resets and security
          alerts.
        </p>
      </div>
    </InviteLayout>
  )
}

export default function Unsubscribe() {
  return (
    <Suspense
      fallback={
        <InviteLayout>
          <div className='space-y-1 text-center'>
            <h1 className={'font-medium text-[32px] text-[var(--landing-text)] tracking-tight'}>
              Loading
            </h1>
            <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
              Validating your unsubscribe link...
            </p>
          </div>
          <div className={'mt-8 flex w-full items-center justify-center py-8'}>
            <Loader2 className='h-8 w-8 animate-spin text-[var(--landing-text-muted)]' />
          </div>
        </InviteLayout>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  )
}
