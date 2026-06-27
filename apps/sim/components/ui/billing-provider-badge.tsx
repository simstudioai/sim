'use client'

import { Badge } from '@/components/emcn'

interface BillingProviderBadgeProps {
  provider: 'stripe' | 'lago' | null
}

export function BillingProviderBadge({ provider }: BillingProviderBadgeProps) {
  if (!provider) return null

  const isLago = provider === 'lago'

  return (
    <Badge variant={isLago ? 'purple' : 'blue'} size="sm">
      {isLago ? 'Lago' : 'Stripe'}
    </Badge>
  )
}
