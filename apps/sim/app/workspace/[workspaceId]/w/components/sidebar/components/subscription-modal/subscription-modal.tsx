'use client'

import { useCallback, useEffect } from 'react'
import {
  Building2,
  Check,
  Clock,
  Database,
  DollarSign,
  HeadphonesIcon,
  Infinity as InfinityIcon,
  MessageSquare,
  Server,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useOrganizationStore } from '@/stores/organization'
import { useSubscriptionStore } from '@/stores/subscription/store'

const logger = createLogger('SubscriptionModal')

interface SubscriptionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface PlanFeature {
  text: string
  included: boolean
  icon?: any
}

export function SubscriptionModal({ open, onOpenChange }: SubscriptionModalProps) {
  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const { activeOrganization } = useOrganizationStore()
  const { loadData, getSubscriptionStatus, isLoading } = useSubscriptionStore()

  // Load subscription data when modal opens
  useEffect(() => {
    if (open) {
      loadData()
    }
  }, [open, loadData])

  const subscription = getSubscriptionStatus()

  const handleUpgrade = useCallback(
    async (targetPlan: 'pro' | 'team') => {
      if (!session?.user?.id) return

      const subscriptionData = useSubscriptionStore.getState().subscriptionData
      const currentSubscriptionId = subscriptionData?.stripeSubscriptionId

      let referenceId = session.user.id
      if (subscription.isTeam && activeOrganization?.id) {
        referenceId = activeOrganization.id
      }

      const currentUrl = window.location.origin + window.location.pathname

      try {
        const upgradeParams: any = {
          plan: targetPlan,
          referenceId,
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          seats: targetPlan === 'team' ? 1 : undefined,
        }

        if (currentSubscriptionId) {
          upgradeParams.subscriptionId = currentSubscriptionId
        }

        await betterAuthSubscription.upgrade(upgradeParams)
      } catch (error) {
        logger.error('Failed to initiate subscription upgrade:', error)
        alert('Failed to initiate upgrade. Please try again or contact support.')
      }
    },
    [session?.user?.id, subscription.isTeam, activeOrganization?.id, betterAuthSubscription]
  )

  const handleContactUs = () => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
  }

  // Define all 4 plans
  const plans = [
    {
      name: 'Free',
      price: '$0',
      description: '',
      features: [
        { text: '$10 free inference credit', included: true, icon: DollarSign },
        { text: '10 runs per minute (sync)', included: true, icon: Zap },
        { text: '50 runs per minute (async)', included: true, icon: Clock },
        { text: '7-day log retention', included: true, icon: Database },
      ],
      isActive: subscription.isFree,
      action: null, // No action for free plan
    },
    {
      name: 'Pro',
      price: '$20',
      description: '/month',
      features: [
        { text: '25 runs per minute (sync)', included: true, icon: Zap },
        { text: '200 runs per minute (async)', included: true, icon: Clock },
        { text: 'Unlimited workspaces', included: true, icon: Building2 },
        { text: 'Unlimited workflows', included: true, icon: Workflow },
        { text: 'Unlimited invites', included: true, icon: Users },
        { text: 'Unlimited log retention', included: true, icon: Database },
      ],
      isActive: subscription.isPro && !subscription.isTeam,
      action: subscription.isFree ? () => handleUpgrade('pro') : null,
    },
    {
      name: 'Team',
      price: '$40',
      description: '/month',
      features: [
        { text: '75 runs per minute (sync)', included: true, icon: Zap },
        { text: '500 runs per minute (async)', included: true, icon: Clock },
        { text: 'Everything in Pro', included: true, icon: InfinityIcon },
        { text: 'Dedicated Slack channel', included: true, icon: MessageSquare },
      ],
      isActive: subscription.isTeam,
      action: !subscription.isTeam ? () => handleUpgrade('team') : null,
    },
    {
      name: 'Enterprise',
      price: '',
      description: '',
      features: [
        { text: 'Custom rate limits', included: true, icon: Zap },
        { text: 'Enterprise hosting license', included: true, icon: Server },
        { text: 'Custom enterprise support', included: true, icon: HeadphonesIcon },
      ],
      isActive: subscription.isEnterprise,
      action: handleContactUs,
    },
  ]

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className='!fixed !inset-0 !m-0 data-[state=open]:!translate-x-0 data-[state=open]:!translate-y-0 flex h-full max-h-full w-full max-w-full flex-col gap-0 rounded-none border-0 p-0'>
        <AlertDialogHeader className='flex-shrink-0 px-6 py-5'>
          <AlertDialogTitle className='font-medium text-lg'>Upgrade your plan</AlertDialogTitle>
        </AlertDialogHeader>

        <div className='flex min-h-0 flex-1 items-center justify-center overflow-hidden px-8 pb-8'>
          <div className='flex w-full max-w-4xl flex-col gap-6'>
            {/* Main Plans Grid - Free, Pro, Team */}
            <div className='grid grid-cols-1 gap-6 md:grid-cols-3'>
              {plans.slice(0, 3).map((plan) => (
                <div
                  key={plan.name}
                  className={cn('relative flex flex-col rounded-[10px] border p-6')}
                >
                  {/* Plan Header */}
                  <div className='mb-6'>
                    <h3 className='mb-3 font-semibold text-lg'>{plan.name}</h3>
                    <div className='flex items-baseline'>
                      <span className='font-semibold text-3xl'>{plan.price}</span>
                      {plan.description && (
                        <span className='ml-1 text-muted-foreground text-sm'>
                          {plan.description}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Features */}
                  <ul className='mb-6 flex-1 space-y-3'>
                    {plan.features.map((feature, index) => (
                      <li key={index} className='flex items-start gap-2 text-sm'>
                        {feature.icon ? (
                          <feature.icon className='mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground' />
                        ) : (
                          <Check className='mt-0.5 h-4 w-4 flex-shrink-0 text-green-500' />
                        )}
                        <span className='text-muted-foreground'>{feature.text}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Action Button */}
                  <div className='mt-auto'>
                    {plan.isActive ? (
                      <Button variant='secondary' className='w-full rounded-[8px]' disabled>
                        Current plan
                      </Button>
                    ) : plan.action ? (
                      <Button
                        onClick={plan.action}
                        className='w-full rounded-[8px]'
                        variant='default'
                      >
                        Upgrade
                      </Button>
                    ) : (
                      <Button variant='outline' className='w-full rounded-[8px]' disabled>
                        {plan.name === 'Free' ? 'Basic plan' : 'Upgrade'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Enterprise Plan - Full Width */}
            <div
              className={cn(
                'relative flex flex-col rounded-[10px] border p-6 md:flex-row md:items-center md:justify-between',
                plans[3].isActive && 'border-gray-400'
              )}
            >
              {/* Left Side - Plan Info */}
              <div className='mb-4 md:mb-0'>
                <h3 className='mb-2 font-semibold text-lg'>{plans[3].name}</h3>
                <p className='mb-3 text-muted-foreground text-sm'>
                  Custom solutions tailored to your enterprise needs
                </p>
                <div className='flex items-center gap-4'>
                  {plans[3].features.map((feature, index) => (
                    <div key={index} className='flex items-center gap-4'>
                      <div className='flex items-center gap-2 text-sm'>
                        {feature.icon ? (
                          <feature.icon className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
                        ) : (
                          <Check className='h-4 w-4 flex-shrink-0 text-green-500' />
                        )}
                        <span className='text-muted-foreground'>{feature.text}</span>
                      </div>
                      {index < plans[3].features.length - 1 && (
                        <div className='h-4 w-px bg-border' />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Side - Button */}
              <div className='md:ml-auto md:w-[200px]'>
                {plans[3].isActive ? (
                  <Button variant='secondary' className='w-full rounded-[8px]' disabled>
                    Current plan
                  </Button>
                ) : plans[3].action ? (
                  <Button
                    onClick={plans[3].action}
                    className='w-full rounded-[8px]'
                    variant='default'
                  >
                    Contact us
                  </Button>
                ) : (
                  <Button className='w-full rounded-[8px]' variant='default' disabled>
                    Contact us
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
