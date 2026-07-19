'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Banner } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { useStopImpersonating } from '@/hooks/queries/admin-users'

function getImpersonationBannerText(userLabel: string, userEmail?: string) {
  return `Impersonating ${userLabel}${userEmail ? ` (${userEmail})` : ''}. Changes will apply to this account until you switch back.`
}

export function ImpersonationBanner() {
  const t = useTranslations('auto')
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
      textClassName={t('text_red_700_dark_text_red')}
      actionLabel={
        stopImpersonating.isPending || isRedirecting ? 'Returning...' : t('stop_impersonating')
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
