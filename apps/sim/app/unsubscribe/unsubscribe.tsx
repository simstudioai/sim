'use client'

import { Suspense } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader } from '@/components/emcn'
import type { UnsubscribeType } from '@/lib/api/contracts/user'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { InviteLayout } from '@/app/invite/components'
import { useUnsubscribe, useUnsubscribeMutation } from '@/hooks/queries/unsubscribe'

function UnsubscribeContent() {
  const t = useTranslations('auto')
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
        <div className='space-y-1 text-center'>
          <h1 className={'font-medium text-[32px] text-[var(--landing-text)] tracking-tight'}>
            {t('loading')}
          </h1>
          <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
            {t('validating_your_unsubscribe_link')}
          </p>
        </div>
        <div className={'mt-8 flex w-full items-center justify-center py-8'}>
          <Loader className='size-8 text-[var(--landing-text-muted)]' animate />
        </div>
      </InviteLayout>
    )
  }

  if (error) {
    return (
      <InviteLayout>
        <div className='space-y-1 text-center'>
          <h1 className={'font-medium text-[32px] text-[var(--landing-text)] tracking-tight'}>
            {t('invalid_unsubscribe_link')}
          </h1>
          <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>{error}</p>
        </div>

        <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
          <button onClick={() => window.history.back()} className={AUTH_SUBMIT_BTN}>
            {t('go_back')}
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
            {t('important_account_emails')}
          </h1>
          <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
            {t('transactional_emails_like_password_resets_accoun')}
          </p>
        </div>

        <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
          <button onClick={() => window.close()} className={AUTH_SUBMIT_BTN}>
            {t('close')}
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
            {t('successfully_unsubscribed')}
          </h1>
          <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
            {t('you_have_been_unsubscribed_from_our')}
          </p>
        </div>

        <div className={'mt-8 w-full max-w-[410px] space-y-3'}>
          <button onClick={() => window.close()} className={AUTH_SUBMIT_BTN}>
            {t('close')}
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
          {t('email_preferences')}
        </h1>
        <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
          {t('choose_which_emails_you_d_like')}
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
              <Loader className='size-4' animate />
              {t('unsubscribing')}
            </span>
          ) : isAlreadyUnsubscribedFromAll ? (
            'Unsubscribed from All Emails'
          ) : (
            'Unsubscribe from All Marketing Emails'
          )}
        </button>

        <div className='py-2 text-center'>
          <span className={'font-[380] text-[var(--landing-text-muted)] text-sm'}>
            {t('or_choose_specific_types')}
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
          {t('you_ll_continue_receiving_important_account')}
        </p>
      </div>
    </InviteLayout>
  )
}

export default function Unsubscribe() {
  const t = useTranslations('auto')
  return (
    <Suspense
      fallback={
        <InviteLayout>
          <div className='space-y-1 text-center'>
            <h1 className={'font-medium text-[32px] text-[var(--landing-text)] tracking-tight'}>
              {t('loading')}
            </h1>
            <p className={'font-[380] text-[var(--landing-text-muted)] text-md'}>
              {t('validating_your_unsubscribe_link')}
            </p>
          </div>
          <div className={'mt-8 flex w-full items-center justify-center py-8'}>
            <Loader className='size-8 text-[var(--landing-text-muted)]' animate />
          </div>
        </InviteLayout>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  )
}
