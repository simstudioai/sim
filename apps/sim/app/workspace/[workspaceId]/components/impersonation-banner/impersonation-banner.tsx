'use client'

import { useState } from 'react'
import { Banner } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { useStopImpersonating } from '@/hooks/queries/admin-users'

function getImpersonationBannerText(userLabel: string, userEmail?: string) {
  return `Impersonating ${userLabel}${userEmail ? ` (${userEmail})` : ''}. Changes will apply to this account until you switch back.`
}

export function ImpersonationBanner() {
  const { data: session, isPending } = useSession()
  const stopImpersonating = useStopImpersonating()
  const [isRedirecting, setIsRedirecting] = useState(false)
  const userLabel = session?.user?.name || 'this user'
  const userEmail = session?.user?.email

  if (isPending || !session?.session?.impersonatedBy) {
    return null
  }

  return (
    <Banner
      variant='destructive'
      text={getImpersonationBannerText(userLabel, userEmail)}
      textClassName='text-red-700 dark:text-red-300'
      actionLabel={
        stopImpersonating.isPending || isRedirecting ? 'Returning...' : 'Stop impersonating'
      }
      actionVariant='destructive'
      actionDisabled={stopImpersonating.isPending || isRedirecting}
      onAction={() =>
        stopImpersonating.mutate(undefined, {
          onError: () => {
            setIsRedirecting(false)
          },
          onSuccess: () => {
            setIsRedirecting(true)
            window.location.assign('/workspace')
          },
        })
      }
    />
  )
}
