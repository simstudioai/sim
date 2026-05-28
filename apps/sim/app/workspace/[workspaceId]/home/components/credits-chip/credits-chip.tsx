'use client'

import { Chip } from '@/components/emcn'
import { Credit } from '@/components/emcn/icons'
import { formatCredits } from '@/lib/billing/credits/conversion'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

export function CreditsChip() {
  if (!isBillingEnabled) return null

  return <CreditsChipInner />
}

function CreditsChipInner() {
  const { data, isLoading } = useSubscriptionData()
  const { navigateToSettings } = useSettingsNavigation()

  if (isLoading || !data?.data) return null

  return (
    <Chip
      aria-label='Manage subscription'
      onClick={() => navigateToSettings({ section: 'subscription' })}
      leftIcon={Credit}
    >
      {formatCredits(data.data.creditBalance)}
    </Chip>
  )
}
