'use client'

import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useOrganizationStore } from '@/stores/organization'
import { useSubscriptionStore } from '@/stores/subscription/store'

const logger = createLogger('CancelSubscription')

interface CancelSubscriptionProps {
  subscription: {
    plan: string
    status: string | null
    isPaid: boolean
  }
  subscriptionData?: {
    periodEnd?: Date | null
  }
}

export function CancelSubscription({ subscription, subscriptionData }: CancelSubscriptionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const { activeOrganization } = useOrganizationStore()
  const { getSubscriptionStatus } = useSubscriptionStore()

  // Clear error after 3 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [error])

  // Don't show for free plans
  if (!subscription.isPaid) {
    return null
  }

  const handleCancel = async () => {
    if (!session?.user?.id) return

    setIsLoading(true)
    setError(null)

    try {
      const subscriptionStatus = getSubscriptionStatus()
      const activeOrgId = activeOrganization?.id

      let referenceId = session.user.id
      if (subscriptionStatus.isTeam && activeOrgId) {
        referenceId = activeOrgId
      }

      logger.info('Canceling subscription', {
        referenceId,
        isTeam: subscriptionStatus.isTeam,
        activeOrgId,
      })

      const result = await betterAuthSubscription.cancel({
        returnUrl: window.location.href,
        referenceId,
      })

      if (result && 'error' in result && result.error) {
        setError(result.error.message || 'Failed to cancel subscription')
        logger.error('Failed to cancel subscription via Better Auth', { error: result.error })
      } else {
        // Better Auth cancel redirects to Stripe Billing Portal
        // So if we reach here without error, the redirect should happen
        logger.info('Redirecting to Stripe Billing Portal for cancellation')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to cancel subscription'
      setError(errorMessage)
      logger.error('Failed to cancel subscription', { error })
    } finally {
      setIsLoading(false)
    }
  }
  const getPeriodEndDate = () => {
    return subscriptionData?.periodEnd || null
  }

  const formatDate = (date: Date | null) => {
    if (!date) return 'end of current billing period'

    try {
      // Ensure we have a valid Date object
      const dateObj = date instanceof Date ? date : new Date(date)

      // Check if the date is valid
      if (Number.isNaN(dateObj.getTime())) {
        return 'end of current billing period'
      }

      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(dateObj)
    } catch (error) {
      console.warn('Invalid date in cancel subscription:', date, error)
      return 'end of current billing period'
    }
  }

  const periodEndDate = getPeriodEndDate()

  return (
    <>
      <div className='flex items-center justify-between'>
        <div>
          <span className='font-medium text-sm'>Manage Subscription</span>
          <p className='mt-1 text-muted-foreground text-xs'>
            You'll keep access until {formatDate(periodEndDate)}
          </p>
        </div>
        <Button
          variant='outline'
          onClick={() => setIsDialogOpen(true)}
          disabled={isLoading}
          className={cn(
            'h-8 rounded-[8px] font-medium text-xs transition-all duration-200',
            error
              ? 'border-red-500 text-red-500 dark:border-red-500 dark:text-red-500'
              : 'text-muted-foreground hover:border-red-500 hover:bg-red-500 hover:text-white dark:hover:border-red-500 dark:hover:bg-red-500'
          )}
        >
          {error ? 'Error' : 'Manage'}
        </Button>
      </div>

      <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {subscription.plan} subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll be redirected to Stripe to manage your subscription. You'll keep access until{' '}
              {formatDate(periodEndDate)}, then downgrade to free plan.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className='py-2'>
            <div className='rounded-[8px] bg-muted/50 p-3 text-sm'>
              <ul className='space-y-1 text-muted-foreground text-xs'>
                <li>• Keep all features until {formatDate(periodEndDate)}</li>
                <li>• No more charges</li>
                <li>• Data preserved</li>
                <li>• Can reactivate anytime</li>
              </ul>
            </div>
          </div>

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='h-9 w-full rounded-[8px]'
              onClick={() => setIsDialogOpen(false)}
              disabled={isLoading}
            >
              Keep Subscription
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
              disabled={isLoading}
            >
              {isLoading ? 'Redirecting...' : 'Continue'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
