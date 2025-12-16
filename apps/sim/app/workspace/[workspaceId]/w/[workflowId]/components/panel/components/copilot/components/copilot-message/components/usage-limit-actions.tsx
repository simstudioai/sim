'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, Check, CreditCard, Loader2 } from 'lucide-react'
import { Button } from '@/components/emcn'
import { useSubscriptionData, useUpdateUsageLimit } from '@/hooks/queries/subscription'
import { canEditUsageLimit } from '@/lib/billing/subscriptions/utils'

/**
 * Component that displays actionable UI when a user hits their usage limit
 * Shows inline input to increase limit or button to upgrade plan
 */
export function UsageLimitActions() {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const { data: subscriptionData } = useSubscriptionData()
  const updateUsageLimitMutation = useUpdateUsageLimit()
  
  const subscription = subscriptionData?.subscription
  const canEdit = subscription ? canEditUsageLimit(subscription) : false
  const currentLimit = subscriptionData?.data?.usage?.limit || 10
  const currentUsage = subscriptionData?.data?.usage?.current || 0
  
  // Suggest an increase of at least $10 or enough to cover current usage + $5
  const suggestedIncrease = Math.max(10, Math.ceil(currentUsage - currentLimit + 5))
  const suggestedLimit = currentLimit + suggestedIncrease
  
  const [newLimit, setNewLimit] = useState(suggestedLimit.toString())
  const [showSuccess, setShowSuccess] = useState(false)

  const handleUpdateLimit = async () => {
    const limitValue = Number.parseFloat(newLimit)
    if (Number.isNaN(limitValue) || limitValue <= currentLimit) {
      return
    }

    try {
      await updateUsageLimitMutation.mutateAsync({ limit: limitValue })
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
    } catch (error) {
      // Error is handled by the mutation
    }
  }

  const handleNavigateToUpgrade = () => {
    router.push(`/workspace/${workspaceId}/settings?tab=subscription`)
  }

  if (!canEdit) {
    // Show upgrade button for users who can't edit (free/enterprise)
    return (
      <div className='mt-3 flex flex-col gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950'>
        <div className='flex items-start gap-2'>
          <CreditCard className='mt-0.5 h-4 w-4 flex-shrink-0 text-orange-600 dark:text-orange-400' />
          <div className='flex-1'>
            <p className='text-sm font-medium text-orange-900 dark:text-orange-100'>
              Usage Limit Reached
            </p>
            <p className='mt-1 text-xs text-orange-700 dark:text-orange-300'>
              Upgrade your plan to get higher limits and continue using the copilot.
            </p>
          </div>
        </div>
        <Button
          onClick={handleNavigateToUpgrade}
          className='w-full justify-between text-sm'
          variant='default'
        >
          <span>Upgrade Plan</span>
          <ArrowRight className='h-4 w-4' />
        </Button>
      </div>
    )
  }

  // Show inline edit for users who can edit their limit
  return (
    <div className='mt-3 flex flex-col gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950'>
      <div className='flex items-start gap-2'>
        <CreditCard className='mt-0.5 h-4 w-4 flex-shrink-0 text-orange-600 dark:text-orange-400' />
        <div className='flex-1'>
          <p className='text-sm font-medium text-orange-900 dark:text-orange-100'>
            Usage Limit Reached
          </p>
          <p className='mt-1 text-xs text-orange-700 dark:text-orange-300'>
            Current limit: ${currentLimit}. Increase your limit to continue.
          </p>
        </div>
      </div>
      
      {showSuccess ? (
        <div className='flex items-center gap-2 rounded-md bg-green-100 px-3 py-2 dark:bg-green-900'>
          <Check className='h-4 w-4 text-green-700 dark:text-green-300' />
          <span className='text-sm text-green-800 dark:text-green-200'>
            Limit updated successfully!
          </span>
        </div>
      ) : (
        <div className='flex gap-2'>
          <div className='relative flex-1'>
            <span className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-600 dark:text-gray-400'>
              $
            </span>
            <input
              type='number'
              value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)}
              min={currentLimit}
              step='1'
              className='h-9 w-full rounded-md border border-orange-300 bg-white pl-6 pr-3 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-orange-700 dark:bg-gray-800 dark:text-gray-100'
              placeholder={suggestedLimit.toString()}
            />
          </div>
          <Button
            onClick={handleUpdateLimit}
            disabled={
              updateUsageLimitMutation.isPending ||
              Number.isNaN(Number.parseFloat(newLimit)) ||
              Number.parseFloat(newLimit) <= currentLimit
            }
            className='h-9 px-4 text-sm'
            variant='primary'
          >
            {updateUsageLimitMutation.isPending ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Updating...
              </>
            ) : (
              'Update Limit'
            )}
          </Button>
        </div>
      )}
      
      {updateUsageLimitMutation.isError && (
        <p className='text-xs text-red-700 dark:text-red-400'>
          {updateUsageLimitMutation.error?.message || 'Failed to update limit'}
        </p>
      )}
    </div>
  )
}
