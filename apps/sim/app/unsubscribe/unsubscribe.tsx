'use client'

import { Suspense } from 'react'
import { Chip, cn, Loader } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useSearchParams } from 'next/navigation'
import type { UnsubscribeType } from '@/lib/api/contracts/user'
import { AuthSubmitButton } from '@/app/(auth)/components'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'
import { InviteLayout } from '@/app/invite/components'
import { InviteHeading } from '@/app/invite/components/invite-heading'
import { useUnsubscribe, useUnsubscribeMutation } from '@/hooks/queries/unsubscribe'

function UnsubscribeContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email')
  const token = searchParams.get('token')

  const hasParams = Boolean(email) && Boolean(token)
  const query = useUnsubscribe(email ?? undefined, token ?? undefined)
  const unsubscribe = useUnsubscribeMutation()

  const data = query.data ?? null
  const loading = hasParams && query.isLoading
  const processing = unsubscribe.isPending
  const unsubscribed = unsubscribe.isSuccess
  const error = !hasParams
    ? 'Missing email or token in URL'
    : query.isError
      ? getErrorMessage(query.error, 'Failed to validate unsubscribe link')
      : unsubscribe.isError
        ? getErrorMessage(unsubscribe.error, 'Failed to process unsubscribe request')
        : null

  const handleUnsubscribe = (type: UnsubscribeType) => {
    if (!email || !token) return
    unsubscribe.mutate({ email, token, type })
  }

  if (loading) {
    return (
      <InviteLayout>
        <InviteHeading title={'Loading'}>
          <p className={'text-[var(--text-muted)] text-md'}>Validating your unsubscribe link…</p>
        </InviteHeading>
        <div className={'mt-8 flex w-full items-center justify-center py-8'}>
          <Loader className='size-8 text-[var(--text-muted)]' animate />
        </div>
      </InviteLayout>
    )
  }

  if (error) {
    return (
      <InviteLayout>
        <InviteHeading title={'Invalid Unsubscribe Link'}>
          <p className={'text-[var(--text-muted)] text-md'}>{error}</p>
        </InviteHeading>

        <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
          <AuthSubmitButton type='button' onClick={() => window.history.back()} loadingLabel=''>
            Go Back
          </AuthSubmitButton>
        </div>
      </InviteLayout>
    )
  }

  if (data?.isTransactional) {
    return (
      <InviteLayout>
        <InviteHeading title={'Important Account Emails'}>
          <p className={'text-[var(--text-muted)] text-md'}>
            Transactional emails like password resets, account confirmations, and security alerts
            cannot be unsubscribed from as they contain essential information for your account.
          </p>
        </InviteHeading>

        <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
          <AuthSubmitButton type='button' onClick={() => window.close()} loadingLabel=''>
            Close
          </AuthSubmitButton>
        </div>
      </InviteLayout>
    )
  }

  if (unsubscribed) {
    return (
      <InviteLayout>
        <InviteHeading title={'Successfully Unsubscribed'}>
          <p className={'text-[var(--text-muted)] text-md'}>
            You have been unsubscribed from our emails. You will stop receiving emails within 48
            hours.
          </p>
        </InviteHeading>

        <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
          <AuthSubmitButton type='button' onClick={() => window.close()} loadingLabel=''>
            Close
          </AuthSubmitButton>
        </div>
      </InviteLayout>
    )
  }

  const isAlreadyUnsubscribedFromAll = data?.currentPreferences.unsubscribeAll

  return (
    <InviteLayout>
      <InviteHeading title={'Email Preferences'}>
        <p className={'text-[var(--text-muted)] text-md'}>
          Choose which emails you'd like to stop receiving.
        </p>
        <p className={'text-[var(--text-muted)] text-sm'}>{data?.email}</p>
      </InviteHeading>

      <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
        <AuthSubmitButton
          type='button'
          onClick={() => handleUnsubscribe('all')}
          disabled={isAlreadyUnsubscribedFromAll}
          loading={processing}
          loadingLabel='Unsubscribing…'
        >
          {isAlreadyUnsubscribedFromAll
            ? 'Unsubscribed from All Emails'
            : 'Unsubscribe from All Marketing Emails'}
        </AuthSubmitButton>

        <div className='py-2 text-center'>
          <span className={'text-[var(--text-muted)] text-sm'}>or choose specific types</span>
        </div>

        <Chip
          fullWidth
          onClick={() => handleUnsubscribe('marketing')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeMarketing
          }
          className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border-1)]')}
        >
          {data?.currentPreferences.unsubscribeMarketing
            ? 'Unsubscribed from Marketing'
            : 'Unsubscribe from Marketing Emails'}
        </Chip>

        <Chip
          fullWidth
          onClick={() => handleUnsubscribe('updates')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeUpdates
          }
          className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border-1)]')}
        >
          {data?.currentPreferences.unsubscribeUpdates
            ? 'Unsubscribed from Updates'
            : 'Unsubscribe from Product Updates'}
        </Chip>

        <Chip
          fullWidth
          onClick={() => handleUnsubscribe('notifications')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeNotifications
          }
          className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border-1)]')}
        >
          {data?.currentPreferences.unsubscribeNotifications
            ? 'Unsubscribed from Notifications'
            : 'Unsubscribe from Notifications'}
        </Chip>
      </div>

      <div className={'mt-6 max-w-[410px] text-center'}>
        <p className='text-[var(--text-muted)] text-small'>
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
          <InviteHeading title={'Loading'}>
            <p className={'text-[var(--text-muted)] text-md'}>Validating your unsubscribe link…</p>
          </InviteHeading>
          <div className={'mt-8 flex w-full items-center justify-center py-8'}>
            <Loader className='size-8 text-[var(--text-muted)]' animate />
          </div>
        </InviteLayout>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  )
}
