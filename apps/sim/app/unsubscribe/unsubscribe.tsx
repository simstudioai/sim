'use client'

import { Suspense } from 'react'
import { AuthHeader, AuthButton as Chip, AuthLoader as Loader } from '@sim/auth-ui'
import { getErrorMessage } from '@sim/utils/errors'
import { useSearchParams } from 'next/navigation'
import type { UnsubscribeType } from '@/lib/api/contracts/user'
import { AuthSubmitButton } from '@/app/(auth)/components'
import { InviteLayout } from '@/app/invite/components'
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
        <AuthHeader title='Loading' description='Validating your unsubscribe link…' />
        <div className='au:mt-[var(--auth-group-gap)] au:flex au:w-full au:items-center au:justify-center au:py-8'>
          <Loader className='au:size-8 au:text-[var(--auth-secondary)]' animate />
        </div>
      </InviteLayout>
    )
  }

  if (error) {
    return (
      <InviteLayout>
        <AuthHeader title='Invalid unsubscribe link' description={error} />

        <div className='au:mt-[var(--auth-group-gap)] au:w-full au:space-y-3'>
          <AuthSubmitButton type='button' onClick={() => window.history.back()} loadingLabel=''>
            Go back
          </AuthSubmitButton>
        </div>
      </InviteLayout>
    )
  }

  if (data?.isTransactional) {
    return (
      <InviteLayout>
        <AuthHeader
          title='Important account emails'
          description='Transactional emails like password resets, account confirmations, and security alerts cannot be unsubscribed from as they contain essential information for your account.'
        />

        <div className='au:mt-[var(--auth-group-gap)] au:w-full au:space-y-3'>
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
        <AuthHeader
          title='Successfully unsubscribed'
          description='You have been unsubscribed from our emails. You will stop receiving emails within 48 hours.'
        />

        <div className='au:mt-[var(--auth-group-gap)] au:w-full au:space-y-3'>
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
      <div className='au:space-y-1'>
        <AuthHeader
          title='Email preferences'
          description="Choose which emails you'd like to stop receiving."
        />
        <p className='au:break-all au:text-[var(--auth-secondary)] au:text-control'>
          {data?.email}
        </p>
      </div>

      <div className='au:mt-[var(--auth-group-gap)] au:w-full au:space-y-3'>
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

        <div className='au:py-2 au:text-center'>
          <span className='au:text-[var(--auth-secondary)] au:text-caption'>
            or choose specific types
          </span>
        </div>

        <Chip
          fullWidth
          onClick={() => handleUnsubscribe('marketing')}
          disabled={
            processing ||
            isAlreadyUnsubscribedFromAll ||
            data?.currentPreferences.unsubscribeMarketing
          }
          variant='outline'
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
          variant='outline'
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
          variant='outline'
        >
          {data?.currentPreferences.unsubscribeNotifications
            ? 'Unsubscribed from Notifications'
            : 'Unsubscribe from Notifications'}
        </Chip>
      </div>

      <div className='au:mt-[var(--auth-group-gap)]'>
        <p className='au:text-[var(--auth-secondary)] au:text-caption'>
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
          <AuthHeader title='Loading' description='Validating your unsubscribe link…' />
          <div className='au:mt-[var(--auth-group-gap)] au:flex au:w-full au:items-center au:justify-center au:py-8'>
            <Loader className='au:size-8 au:text-[var(--auth-secondary)]' animate />
          </div>
        </InviteLayout>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  )
}
