'use client'

import { ArrowLeft } from '@sim/emcn-legacy/icons'
import { useRouter } from 'next/navigation'
import { SettingsPanel } from '@/components/settings/primitives/settings-panel'

interface CreditUsageLoadingProps {
  backHref: string
}

/**
 * Shared credit-usage loading chrome with an explicit navigation destination.
 */
export function CreditUsageLoading({ backHref }: CreditUsageLoadingProps) {
  const router = useRouter()

  return (
    <SettingsPanel
      back={{
        text: 'Subscription',
        icon: ArrowLeft,
        onSelect: () => router.push(backHref),
      }}
      title='Credit usage'
      description='Every credit-consuming event behind your usage.'
    />
  )
}
