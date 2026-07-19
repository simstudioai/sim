'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/emcn'

interface BillingProviderBadgeProps {
  provider: 'stripe' | 'lago' | null
}

export function BillingProviderBadge({ provider }: BillingProviderBadgeProps) {
  const t = useTranslations('auto')
  if (!provider) return null

  const isLago = provider === 'lago'

  return (
    <Badge variant={isLago ? 'purple' : 'blue'} size='sm'>
      {isLago ? t('lago') : t('stripe')}
    </Badge>
  )
}
