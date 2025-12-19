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

  // The billing API returns { success, context, data }, where data contains plan/status
  const subscription = subscriptionData?.data
  const canEdit = subscription ? canEditUsageLimit(subscription) : false

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [isHidden, setIsHidden] = useState(false)

  // Fixed limit options
  const limitOptions = [50, 100, 150]

  const handleUpdateLimit = async (newLimit: number) => {
    setSelectedAmount(newLimit)
    try {
      await updateUsageLimitMutation.mutateAsync({ limit: newLimit })

      // Hide the buttons immediately
      setIsHidden(true)

      // Get the store state and retry the last user message
      const { messages, sendMessage } = useCopilotStore.getState()

      // Find the last user message (before the error)
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')

      if (lastUserMessage) {
        // Remove the error message (assistant message with usage_limit error)
        const filteredMessages = messages.filter(
          (m) => !(m.role === 'assistant' && m.errorType === 'usage_limit')
        )

        // Update messages to remove the error message
        useCopilotStore.setState({ messages: filteredMessages })

        // Retry the original query by passing the same messageId
        // This replaces from that point instead of duplicating
        await sendMessage(lastUserMessage.content, {
          fileAttachments: lastUserMessage.fileAttachments,
          contexts: lastUserMessage.contexts,
          messageId: lastUserMessage.id,
        })
      }
    } catch (error) {
      // Error is handled by the mutation
      setIsHidden(false)
    } finally {
      setSelectedAmount(null)
    }
  }

  const handleNavigateToUpgrade = () => {
    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'subscription' } }))
  }

  // Hide if already processed
  if (isHidden) {
    return null
  }

  if (!canEdit) {
    // Show upgrade button for users who can't edit (free/enterprise)
    return (
      <div className='mt-[12px] flex gap-[6px]'>
        <Button onClick={handleNavigateToUpgrade} variant='default'>
          Upgrade Plan
        </Button>
      </div>
    )
  }

  // Show button options for users who can edit their limit
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
