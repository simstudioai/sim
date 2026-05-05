'use client'

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

  const chipLabel = formatCredits(data.data.creditBalance)

  return (
    <button
      type='button'
      aria-label='Manage subscription'
      onClick={() => navigateToSettings({ section: 'subscription' })}
      className='group mx-0.5 inline-flex h-[30px] items-center gap-1.5 rounded-lg px-2 transition-colors hover-hover:bg-[var(--surface-active)]'
    >
      <Credit className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='font-base text-[var(--text-body)] text-sm'>{chipLabel}</span>
    </button>
  )
}
