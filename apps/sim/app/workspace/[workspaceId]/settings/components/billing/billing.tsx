'use client'

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, ChipLink, Credit, Switch } from '@/components/emcn'
import { getDisplayPlanName, getPlanTierDollars } from '@/lib/billing/plan-helpers'
import { UsageLimitField } from '@/app/workspace/[workspaceId]/settings/components/billing/components/usage-limit-field/usage-limit-field'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { usePlanView } from '@/hooks/queries/plan-view'
import { prefetchUpgradeBillingData, useSubscriptionData } from '@/hooks/queries/subscription'
import { prefetchWorkspaceSettings } from '@/hooks/queries/workspace'

interface InvoiceRow {
  id: string
  label: string
  amount: string
}

export function Billing() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data } = useSubscriptionData()
  const { planView, isLoading, hasData } = usePlanView()

  const [onDemandEnabled, setOnDemandEnabled] = useState(false)

  const upgradeHref = `/workspace/${workspaceId}/upgrade`

  /**
   * Warm the Upgrade route bundle and the exact queries that page gates on, so
   * the click navigates into already-cached data instead of a loading state.
   */
  const prefetchUpgrade = useCallback(() => {
    router.prefetch(upgradeHref)
    prefetchUpgradeBillingData(queryClient)
    prefetchWorkspaceSettings(queryClient, workspaceId)
  }, [router, queryClient, upgradeHref, workspaceId])

  if (isLoading || !hasData) return null
  if (planView.isEnterprise) return null

  const isFree = planView.isFree
  const plan = data?.data?.plan ?? 'free'
  const planName = getDisplayPlanName(plan)
  const billingPeriod =
    data?.data?.billingInterval === 'year' ? 'billed annually' : 'billed monthly'
  const priceText = `$${getPlanTierDollars(plan)} per user/month, ${billingPeriod}`

  // Invoices are managed in Stripe and not yet exposed to the frontend, so this
  // is empty for now and the Invoices section below is hidden when there are none.
  const invoices: InvoiceRow[] = []

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <div />
        <div className='h-[30px]' />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <div className='flex flex-col gap-1'>
            <h1 className='font-medium text-[var(--text-body)] text-lg'>Billing</h1>
            <p className='text-[var(--text-muted)] text-md'>
              Manage your plan, pricing, and invoices.
            </p>
          </div>

          <div className='flex items-center justify-between gap-3'>
            <div className='flex items-center gap-2.5'>
              <div className='size-9 flex-shrink-0'>
                <div className='flex size-full items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
                  <Credit className='size-5 text-[var(--text-icon)]' />
                </div>
              </div>
              <div className='flex min-w-0 flex-col'>
                <span className='truncate text-[14px] text-[var(--text-body)]'>
                  {planName} plan
                </span>
                <span className='truncate text-[12px] text-[var(--text-muted)]'>{priceText}</span>
              </div>
            </div>
            <ChipLink
              href={upgradeHref}
              variant='border-shadow'
              flush
              onMouseEnter={prefetchUpgrade}
              onFocus={prefetchUpgrade}
            >
              Explore plans
            </ChipLink>
          </div>

          {!isFree && (
            <>
              <UsageLimitField />

              <SettingsSection label='Enable on-demand usage'>
                <div className='flex items-center justify-between'>
                  <span className='text-[var(--text-body)] text-small'>
                    Allow usage to go past usage limit
                  </span>
                  <Switch checked={onDemandEnabled} onCheckedChange={setOnDemandEnabled} />
                </div>
              </SettingsSection>

              {invoices.length > 0 && (
                <SettingsSection label='Invoices'>
                  <div className='-mx-2 flex flex-col gap-y-0.5'>
                    {invoices.map((invoice) => (
                      <button
                        key={invoice.id}
                        type='button'
                        className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                      >
                        <span className='min-w-0 flex-1 truncate text-[14px] text-[var(--text-body)]'>
                          {invoice.label}
                        </span>
                        <span className='flex-shrink-0 text-[12px] text-[var(--text-muted)]'>
                          {invoice.amount}
                        </span>
                        <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
                      </button>
                    ))}
                  </div>
                </SettingsSection>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
