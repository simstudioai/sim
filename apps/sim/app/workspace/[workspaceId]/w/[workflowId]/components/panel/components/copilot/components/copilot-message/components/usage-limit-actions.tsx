'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/emcn'
import { canEditUsageLimit } from '@/lib/billing/subscriptions/utils'
import { useSubscriptionData, useUpdateUsageLimit } from '@/hooks/queries/subscription'
import { useCopilotStore } from '@/stores/panel/copilot/store'

/**
 * Component that displays actionable UI when a user hits their usage limit
 * Shows button options to increase limit or button to upgrade plan
 * After updating limit, retries the original user query
 */
export function UsageLimitActions() {
  const { data: subscriptionData } = useSubscriptionData()
  const updateUsageLimitMutation = useUpdateUsageLimit()

  const subscription = subscriptionData?.data
  const canEdit = subscription ? canEditUsageLimit(subscription) : false

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [isHidden, setIsHidden] = useState(false)

  const limitOptions = [50, 100, 150]

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
    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'subscription' } }))
  }

  if (isHidden) {
    return null
  }

  if (!canEdit) {
    return (
      <div className='mt-[12px] flex gap-[6px]'>
        <Button onClick={handleNavigateToUpgrade} variant='default'>
          Upgrade Plan
        </Button>
      </div>
    )
  }

  return (
    <div className='mt-[12px] flex gap-[6px]'>
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
            {isLoading ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}${limit}
          </Button>
        )
      })}
    </div>
  )
}
