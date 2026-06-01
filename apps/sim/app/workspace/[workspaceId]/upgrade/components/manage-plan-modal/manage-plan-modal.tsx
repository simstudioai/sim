'use client'

import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { Info } from 'lucide-react'
import {
  Badge,
  Button,
  Combobox,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from '@/components/emcn'
import { ANNUAL_DISCOUNT_RATE, CREDIT_TIERS } from '@/lib/billing/constants'
import { cn } from '@/lib/core/utils/cn'

const PRO_TIER = CREDIT_TIERS[0]
const MAX_TIER = CREDIT_TIERS[1]

/**
 * Single admin user selectable in the "Billed Account" combobox.
 */
export interface BilledAccountAdmin {
  userId: string
  email: string
}

/**
 * Optional "Billing details" section embedded inside the modal. When omitted,
 * the modal renders only the plan-action list. Surface this only for paid
 * customers where billing controls are meaningful.
 */
export interface ManagePlanBillingDetails {
  /** Rendered usage header (plan title, usage progress, on-demand toggle). */
  usageHeader?: ReactNode
  /** Credit balance card. */
  creditBalance?: ReactNode
  /** Billing usage notifications toggle. */
  notificationsToggle?: ReactNode
  /** Period end date (renders next-billing/access-until row). */
  periodEnd?: string | null
  /** Whether the subscription is cancelled at period end. */
  isCancelledAtPeriodEnd?: boolean
  /** Whether to show the Stripe payment / invoices actions. */
  showStripeActions?: boolean
  /** Whether the Stripe portal call is in flight. */
  isBillingPortalPending?: boolean
  /** Opens the Stripe billing portal. */
  onOpenBillingPortal?: () => void
  /** Whether to show the Billed Account combobox. */
  showBilledAccount?: boolean
  /** Workspace admins eligible to receive billing. */
  workspaceAdmins?: BilledAccountAdmin[]
  /** Currently selected billed admin. */
  billedAccountUserId?: string | null
  /** Whether the combobox is interactable. */
  canManageWorkspaceKeys?: boolean
  /** Whether the workspace-settings mutation is in flight. */
  isUpdatingWorkspace?: boolean
  /** Selection handler for the billed account. */
  onChangeBilledAccount?: (userId: string) => Promise<void>
}

/**
 * Props for {@link ManagePlanModal}.
 */
export interface ManagePlanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPlanCredits: number
  currentPlanDollars: number
  currentInterval: 'month' | 'year'
  isTeamPlan: boolean
  isCancelledAtPeriodEnd: boolean
  isLegacyPlan: boolean
  onSwitchInterval: (interval: 'month' | 'year') => Promise<void>
  onUpgradeToOtherTier: () => void
  onUpgradeToCurrentTier: () => void
  onCancel: () => void
  onRestore: () => void
  /** Optional billing-details section embedded inside the modal body. */
  billingDetails?: ManagePlanBillingDetails
}

/**
 * Modal for managing the current paid plan: switch billing interval, upgrade
 * or switch tiers, view usage and credit balance, manage payment methods, and
 * cancel or restore the subscription.
 */
export function ManagePlanModal({
  open,
  onOpenChange,
  currentPlanCredits,
  currentPlanDollars,
  currentInterval,
  isTeamPlan,
  isCancelledAtPeriodEnd,
  isLegacyPlan,
  onSwitchInterval,
  onUpgradeToOtherTier,
  onUpgradeToCurrentTier,
  onCancel,
  onRestore,
  billingDetails,
}: ManagePlanModalProps) {
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const prevOpenRef = useRef(open)
  if (prevOpenRef.current !== open) {
    prevOpenRef.current = open
    if (open) setError(null)
  }

  const isOnMax = currentPlanCredits === MAX_TIER.credits || (isLegacyPlan && isTeamPlan)
  const currentTier = isOnMax ? MAX_TIER : PRO_TIER
  const otherTier = isOnMax ? PRO_TIER : MAX_TIER
  const isUpgrade = otherTier.dollars > currentTier.dollars
  const targetInterval = currentInterval === 'month' ? 'year' : 'month'

  const perUnit = isTeamPlan ? '/seat' : ''
  const actualAnnualTotal = Math.round(currentPlanDollars * 12 * (1 - ANNUAL_DISCOUNT_RATE))
  const actualDiscountedMonthly = Math.round(actualAnnualTotal / 12)

  const handleSwitchInterval = async () => {
    setIsSwitching(true)
    setError(null)
    try {
      await onSwitchInterval(targetInterval)
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to switch interval'))
    } finally {
      setIsSwitching(false)
    }
  }

  const actions = [
    ...(!isLegacyPlan
      ? [
          {
            title:
              currentInterval === 'month'
                ? 'Switch to annual billing'
                : 'Switch to monthly billing',
            description:
              currentInterval === 'month'
                ? `$${actualDiscountedMonthly}/mo${perUnit} ($${actualAnnualTotal}/yr${perUnit}) — save 15%`
                : `$${currentTier.dollars}/mo${perUnit} — billed monthly`,
            buttonText: isSwitching ? 'Switching...' : 'Switch',
            onClick: handleSwitchInterval,
            disabled: isSwitching,
          },
        ]
      : [
          {
            title: `Upgrade to current ${currentTier.name} plan`,
            description: `${currentTier.credits.toLocaleString()} credits/mo · $${currentTier.dollars}/mo${perUnit} — unlocks annual billing`,
            buttonText: isSwitching ? 'Upgrading...' : 'Upgrade',
            onClick: onUpgradeToCurrentTier,
            disabled: isSwitching,
          },
        ]),
    {
      title: isUpgrade ? `Upgrade to ${otherTier.name}` : `Switch to ${otherTier.name}`,
      description: `${otherTier.credits.toLocaleString()} credits/mo · $${otherTier.dollars}/mo${perUnit}`,
      buttonText: isUpgrade ? 'Upgrade' : 'Switch',
      onClick: onUpgradeToOtherTier,
    },
  ]

  const hasBillingDetails =
    !!billingDetails &&
    (!!billingDetails.usageHeader ||
      !!billingDetails.creditBalance ||
      !!billingDetails.notificationsToggle ||
      !!billingDetails.periodEnd ||
      !!billingDetails.showStripeActions ||
      !!billingDetails.showBilledAccount)

  const modalSize = hasBillingDetails ? 'lg' : 'sm'

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size={modalSize}>
        <ModalHeader>
          Manage {currentTier.name} Plan{isTeamPlan ? ' (Team)' : ''}
        </ModalHeader>
        <ModalBody>
          <ModalDescription className='text-[var(--text-secondary)]'>
            You're on the{' '}
            <span className='font-medium text-[var(--text-primary)]'>{currentTier.name}</span> plan
            {isTeamPlan ? ' for your team' : ''}, billed{' '}
            {currentInterval === 'month'
              ? `$${currentPlanDollars}/mo${perUnit}`
              : `$${actualAnnualTotal}/yr${perUnit} ($${actualDiscountedMonthly}/mo${perUnit})`}
            .
          </ModalDescription>

          {isLegacyPlan && (
            <Badge variant='amber' size='lg' dot className='mt-2'>
              You're on an older version of this plan
            </Badge>
          )}

          <div className='mt-4 flex flex-col'>
            {actions.map((action, i) => (
              <div
                key={action.title}
                className={cn(
                  'flex items-center justify-between py-3',
                  i > 0 && 'border-[var(--border-1)] border-t'
                )}
              >
                <div className='min-w-0 flex-1'>
                  <span className='font-medium text-[var(--text-primary)] text-small'>
                    {action.title}
                  </span>
                  <span className='block text-[var(--text-secondary)] text-caption'>
                    {action.description}
                  </span>
                </div>
                <Button
                  variant='primary'
                  className='ml-3 shrink-0'
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.buttonText}
                </Button>
              </div>
            ))}
          </div>

          {error && (
            <span className='mt-1 block text-[var(--text-error)] text-caption'>{error}</span>
          )}

          {hasBillingDetails && billingDetails && (
            <div className='mt-6 flex flex-col gap-5 border-[var(--border-1)] border-t pt-5'>
              <span className='font-medium text-[var(--text-primary)] text-small'>
                Billing details
              </span>

              {billingDetails.usageHeader}

              {billingDetails.creditBalance}

              {billingDetails.periodEnd && (
                <div className='flex items-center justify-between gap-4'>
                  <Label>
                    {billingDetails.isCancelledAtPeriodEnd ? 'Access Until' : 'Next Billing Date'}
                  </Label>
                  <span className='text-[var(--text-secondary)] text-small'>
                    {new Date(billingDetails.periodEnd).toLocaleDateString()}
                  </span>
                </div>
              )}

              {billingDetails.notificationsToggle}

              {billingDetails.showStripeActions && (
                <>
                  <div className='flex items-center justify-between gap-4'>
                    <Label>Payment method</Label>
                    <Button
                      variant='active'
                      disabled={billingDetails.isBillingPortalPending}
                      onClick={() => billingDetails.onOpenBillingPortal?.()}
                    >
                      Manage in Stripe
                    </Button>
                  </div>

                  <div className='flex items-center justify-between gap-4'>
                    <Label>Invoices</Label>
                    <Button
                      variant='active'
                      disabled={billingDetails.isBillingPortalPending}
                      onClick={() => billingDetails.onOpenBillingPortal?.()}
                    >
                      View Invoices
                    </Button>
                  </div>
                </>
              )}

              {billingDetails.showBilledAccount && (
                <div className='flex items-center justify-between gap-4'>
                  <div className='flex items-center gap-1.5'>
                    <Label htmlFor='billed-account'>Billed Account</Label>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Info className='size-[12px] text-[var(--text-secondary)]' />
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        <span>Usage from this workspace will be billed to this account</span>
                      </Tooltip.Content>
                    </Tooltip.Root>
                  </div>
                  {(billingDetails.workspaceAdmins ?? []).length === 0 ? (
                    <div className='rounded-md border border-[var(--border)] border-dashed px-3 py-1.5 text-[var(--text-muted)] text-small'>
                      No admins available
                    </div>
                  ) : (
                    <div className='w-[200px]'>
                      <Combobox
                        size='sm'
                        align='end'
                        dropdownWidth={200}
                        value={billingDetails.billedAccountUserId || ''}
                        onChange={async (value: string) => {
                          if (value && value !== billingDetails.billedAccountUserId) {
                            try {
                              await billingDetails.onChangeBilledAccount?.(value)
                            } catch {
                              /* logged in hook */
                            }
                          }
                        }}
                        disabled={
                          !billingDetails.canManageWorkspaceKeys ||
                          !!billingDetails.isUpdatingWorkspace
                        }
                        placeholder='Select admin'
                        options={(billingDetails.workspaceAdmins ?? []).map((admin) => ({
                          label: admin.email,
                          value: admin.userId,
                        }))}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          {isCancelledAtPeriodEnd ? (
            <>
              <Button variant='default' onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant='primary' onClick={onRestore}>
                Restore Subscription
              </Button>
            </>
          ) : (
            <>
              <Button variant='destructive' onClick={onCancel}>
                Cancel subscription
              </Button>
              <Button variant='default' onClick={() => onOpenChange(false)}>
                Keep Subscription
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
