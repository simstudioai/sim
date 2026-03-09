'use client'

import { Suspense, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
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
          <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
            Loading
          </h1>
          <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
            Validating your unsubscribe link...
          </p>
        </div>
        <div className={`${inter.className} mt-8 flex w-full items-center justify-center py-8`}>
          <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
        </div>
        <SupportFooter position='absolute' />
      </InviteLayout>
    )
  }

  if (error) {
    return (
      <InviteLayout>
        <div className='space-y-1 text-center'>
          <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
            Invalid Unsubscribe Link
          </h1>
          <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
            {error}
          </p>
        </div>

        <div className={`${inter.className} mt-8 w-full max-w-[410px] space-y-3`}>
          <BrandedButton onClick={() => window.history.back()}>Go Back</BrandedButton>
        </div>

        <SupportFooter position='absolute' />
      </InviteLayout>
    )
  }

  if (data?.isTransactional) {
    return (
      <InviteLayout>
        <div className='space-y-1 text-center'>
          <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
            Important Account Emails
          </h1>
          <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
            Transactional emails like password resets, account confirmations, and security alerts
            cannot be unsubscribed from as they contain essential information for your account.
          </p>
        </div>

        <div className={`${inter.className} mt-8 w-full max-w-[410px] space-y-3`}>
          <BrandedButton onClick={() => window.close()}>Close</BrandedButton>
        </div>

        <SupportFooter position='absolute' />
      </InviteLayout>
    )
  }

  if (unsubscribed) {
    return (
      <InviteLayout>
        <div className='space-y-1 text-center'>
          <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
            Successfully Unsubscribed
          </h1>
          <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
            You have been unsubscribed from our emails. You will stop receiving emails within 48
            hours.
          </p>
        </div>

        <div className={`${inter.className} mt-8 w-full max-w-[410px] space-y-3`}>
          <BrandedButton onClick={() => window.close()}>Close</BrandedButton>
        </div>

        <SupportFooter position='absolute' />
      </InviteLayout>
    )
  }

  const isAlreadyUnsubscribedFromAll = data?.currentPreferences.unsubscribeAll

  return (
    <InviteLayout>
      <div className='space-y-1 text-center'>
        <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
          Email Preferences
        </h1>
        <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
          Choose which emails you'd like to stop receiving.
        </p>
        <p className={`${inter.className} mt-2 font-[380] text-[14px] text-muted-foreground`}>
          {data?.email}
        </p>
      </div>

      <div className={`${inter.className} mt-8 w-full max-w-[410px] space-y-3`}>
        <BrandedButton
          onClick={() => handleUnsubscribe('all')}
          disabled={processing || isAlreadyUnsubscribedFromAll}
          loading={processing}
          loadingText='Unsubscribing'
        >
          {isAlreadyUnsubscribedFromAll
            ? 'Unsubscribed from All Emails'
            : 'Unsubscribe from All Marketing Emails'}
        </BrandedButton>

        <div className='py-2 text-center'>
          <span className={`${inter.className} font-[380] text-[14px] text-muted-foreground`}>
            or choose specific types
          </span>
        </div>

        <BrandedButton
          onClick={() => handleUnsubscribe('marketing')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeMarketing
          }
        >
          {data?.currentPreferences.unsubscribeMarketing
            ? 'Unsubscribed from Marketing'
            : 'Unsubscribe from Marketing Emails'}
        </BrandedButton>

        <BrandedButton
          onClick={() => handleUnsubscribe('updates')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeUpdates
          }
        >
          {data?.currentPreferences.unsubscribeUpdates
            ? 'Unsubscribed from Updates'
            : 'Unsubscribe from Product Updates'}
        </BrandedButton>

        <BrandedButton
          onClick={() => handleUnsubscribe('notifications')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeNotifications
          }
        >
          {data?.currentPreferences.unsubscribeNotifications
            ? 'Unsubscribed from Notifications'
            : 'Unsubscribe from Notifications'}
        </BrandedButton>
      </div>

      <div className={`${inter.className} mt-6 max-w-[410px] text-center`}>
        <p className='font-[380] text-[13px] text-muted-foreground'>
          You'll continue receiving important account emails like password resets and security
          alerts.
        </p>
      </div>

      <SupportFooter position='absolute' />
    </InviteLayout>
  )
}

export default function Unsubscribe() {
  return (
    <Suspense
      fallback={
        <InviteLayout>
          <div className='space-y-1 text-center'>
            <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
              Loading
            </h1>
            <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
              Validating your unsubscribe link...
            </p>
          </div>
          <div className={`${inter.className} mt-8 flex w-full items-center justify-center py-8`}>
            <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
          </div>
          <SupportFooter position='absolute' />
        </InviteLayout>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  )
}
