'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/emcn'
import { formatCredits } from '@/lib/billing/credits/conversion'
import { canEditUsageLimit } from '@/lib/billing/subscriptions/utils'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/feature-flags'
import { useSubscriptionData, useUpdateUsageLimit } from '@/hooks/queries/subscription'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useCopilotStore } from '@/stores/panel'

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))
const LIMIT_INCREMENTS = [0, 50, 100] as const

function roundUpToNearest50(value: number): number {
  return Math.ceil(value / 50) * 50
}

export function UsageLimitActions() {
  const { navigateToSettings } = useSettingsNavigation()
  const { data: subscriptionData } = useSubscriptionData({ enabled: isBillingEnabled })
  const updateUsageLimitMutation = useUpdateUsageLimit()

  const subscription = subscriptionData?.data
  const canEdit = subscription ? canEditUsageLimit(subscription) : false

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [isHidden, setIsHidden] = useState(false)

  const currentLimit = subscription?.usageLimit ?? 0
  const baseLimit = roundUpToNearest50(currentLimit) || 50
  const limitOptions = LIMIT_INCREMENTS.map((increment) => baseLimit + increment)

  const handleUpdateLimit = async (newLimit: number) => {
    setSelectedAmount(newLimit)
    try {
      await updateUsageLimitMutation.mutateAsync({ limit: newLimit })

      setIsHidden(true)

      const { messages, sendMessage } = useCopilotStore.getState()
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')

      if (lastUserMessage) {
        const filteredMessages = messages.filter(
          (m) => !(m.role === 'assistant' && m.errorType === 'usage_limit')
        )
        useCopilotStore.setState({ messages: filteredMessages })

        await sendMessage(lastUserMessage.content, {
          fileAttachments: lastUserMessage.fileAttachments,
          contexts: lastUserMessage.contexts,
          messageId: lastUserMessage.id,
        })
      }
    } catch {
      setIsHidden(false)
    } finally {
      setSelectedAmount(null)
    }
  }

  const handleNavigateToUpgrade = () => {
    if (isHosted) {
      navigateToSettings({ section: 'subscription' })
    } else {
      window.open('https://www.sim.ai', '_blank')
    }
  }

  if (isHidden) {
    return null
  }

  if (!isHosted || !canEdit) {
    return (
      <Button onClick={handleNavigateToUpgrade} variant='default'>
        Upgrade
      </Button>
    )
  }

  return (
    <>
      {limitOptions.map((limit) => {
        const isLoading = updateUsageLimitMutation.isPending && selectedAmount === limit
        const isDisabled = updateUsageLimitMutation.isPending

        return (
          <Button
            key={limit}
            onClick={() => handleUpdateLimit(limit)}
            disabled={isDisabled}
            variant='default'
          >
            {isLoading ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
            {formatCredits(limit)}
          </Button>
        )
      })}
    </>
  )
}
