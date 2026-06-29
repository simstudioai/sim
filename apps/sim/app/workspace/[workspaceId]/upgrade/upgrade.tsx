'use client'

import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQueryState } from 'nuqs'
import { ArrowLeft, Chip, toast } from '@/components/emcn'
import {
  getUpgradeCardCta,
  type PlanCardCta,
  type PlanTier,
  type UpgradeCardId,
} from '@/lib/billing/client'
import { ANNUAL_DISCOUNT_RATE } from '@/lib/billing/constants'
import { DEFAULT_UPGRADE_HEADER, UPGRADE_REASON_COPY } from '@/lib/billing/upgrade-reasons'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  BillingPeriodToggle,
  ComparisonTable,
  UpgradePlanCard,
} from '@/app/workspace/[workspaceId]/upgrade/components'
import { useUpgradeState } from '@/app/workspace/[workspaceId]/upgrade/hooks'
import {
  ENTERPRISE_PLAN_CREDITS,
  ENTERPRISE_PLAN_FEATURES,
  MAX_PLAN_CREDITS,
  MAX_PLAN_FEATURES,
  PRO_PLAN_CREDITS,
  PRO_PLAN_FEATURES,
} from '@/app/workspace/[workspaceId]/upgrade/plan-configs'
import {
  upgradeReasonParam,
  upgradeUrlKeys,
} from '@/app/workspace/[workspaceId]/upgrade/search-params'
import { useFullscreenOriginStore } from '@/stores/fullscreen-origin'

const TYPEFORM_ENTERPRISE_URL = 'https://form.typeform.com/to/jqCO12pF' as const

/**
 * Props for {@link Upgrade}.
 */
export interface UpgradeProps {
  workspaceId: string
}

/**
 * Full-screen Upgrade page. Renders the plan cards and the billing-period
 * toggle on top of the derived state from {@link useUpgradeState}. Plan and
 * billing management (payment method, cancellation, invoices) lives on the
 * Billing settings page.
 */
export function Upgrade({ workspaceId }: UpgradeProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const state = useUpgradeState()
  const router = useRouter()
  const origin = useFullscreenOriginStore((s) => s.origin)
  const [reason] = useQueryState(upgradeReasonParam.key, {
    ...upgradeReasonParam.parser,
    ...upgradeUrlKeys,
  })
  const [showAllFeatures, setShowAllFeatures] = useState(false)

  const header = reason ? UPGRADE_REASON_COPY[reason].header : DEFAULT_UPGRADE_HEADER

  const handleBack = useCallback(() => {
    router.replace(origin ?? `/workspace/${workspaceId}/home`)
  }, [origin, router, workspaceId])

  // Enterprise manages billing out-of-band, and self-hosted deployments with
  // billing disabled have no plans to surface — redirect to home in both cases.
  useEffect(() => {
    if (!isBillingEnabled) {
      router.replace(`/workspace/${workspaceId}/home`)
      return
    }
    if (!state.isLoading && state.subscription.isEnterprise) {
      router.replace(`/workspace/${workspaceId}/home`)
    }
  }, [state.isLoading, state.subscription.isEnterprise, router, workspaceId])

  if (!isBillingEnabled || state.isLoading || state.subscription.isEnterprise) return null

  // Enterprise is redirected above, so the current plan is only ever free/pro/max here.
  const planTier: PlanTier = state.subscription.isFree ? 'free' : state.isOnMaxTier ? 'max' : 'pro'

  /**
   * Resolve a card's CTA from the canonical matrix, then bind it to the matching
   * handler. A same-tier "Manage plan" card flips to an interval switch when the
   * billing-period toggle differs from the active subscription interval.
   */
  const resolveCta = (
    card: UpgradeCardId
  ): PlanCardCta & { onClick: () => void; disabled?: boolean } => {
    const cta = getUpgradeCardCta(planTier, card)

    if (cta.intent === 'manage') {
      // Same-tier card. A billing-period toggle mismatch turns it into an
      // interval switch; otherwise it's a non-actionable "Current Plan" marker
      // (plan management lives on the Billing settings page).
      if (state.wantsIntervalSwitch) {
        return {
          ...cta,
          label: `Switch to ${state.isAnnual ? 'Annual' : 'Monthly'}`,
          onClick: () =>
            state
              .handleSwitchInterval(state.isAnnual ? 'year' : 'month')
              .catch((e) => toast.error(getErrorMessage(e, 'Failed to switch interval'))),
        }
      }
      return { ...cta, onClick: () => {}, disabled: true }
    }

    const onClick = (): void => {
      switch (cta.intent) {
        case 'sales':
          window.open(TYPEFORM_ENTERPRISE_URL, '_blank')
          return
        case 'downgrade':
          void state.onUpgradeToOtherTier()
          return
        case 'upgrade':
          if (card === 'max') {
            if (state.subscription.isPaid) void state.upgradeOrSwitchToMax()
            else state.doUpgrade('pro', state.maxTier.credits)
          } else {
            state.doUpgrade('pro', state.proTier.credits)
          }
      }
    }

    return { ...cta, onClick }
  }

  const proCta = resolveCta('pro')
  const maxCta = resolveCta('max')
  const enterpriseCta = resolveCta('enterprise')

  // Comparison-table CTAs reuse the card CTAs verbatim so both stay in sync.
  // Free has no card and intentionally renders no button.
  const comparisonCtas = { Pro: proCta, Max: maxCta, Enterprise: enterpriseCta }

  const proBanner = state.isOnPro ? 'Your plan' : undefined
  const maxBanner = state.isOnMax ? 'Your plan' : undefined

  const discountPct = Math.round(ANNUAL_DISCOUNT_RATE * 100)
  const proPrice = state.isAnnual
    ? Math.round(state.proTier.dollars * (1 - ANNUAL_DISCOUNT_RATE))
    : state.proTier.dollars
  const maxPrice = state.isAnnual
    ? Math.round(state.maxTier.dollars * (1 - ANNUAL_DISCOUNT_RATE))
    : state.maxTier.dollars
  const priceSubtext = state.isAnnual
    ? 'per user/month, billed annually'
    : 'per user/month, billed monthly'

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <Chip leftIcon={ArrowLeft} onClick={handleBack}>
          {t('back')}
        </Chip>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex w-full max-w-[960px] flex-col gap-7 pt-6 pb-3'>
          <div className='flex flex-col items-center gap-4'>
            <h1 className='text-balance text-center font-season text-[30px] text-[var(--text-primary)]'>
              {header}
            </h1>
            {state.showUpgradePlans && (
              <BillingPeriodToggle isAnnual={state.isAnnual} onChange={state.setIsAnnual} />
            )}
          </div>

          {state.showUpgradePlans && (
            <>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
                <UpgradePlanCard
                  name='Pro'
                  price={`$${proPrice}`}
                  discountLabel={state.isAnnual ? `${discountPct}% off` : undefined}
                  priceSubtext={priceSubtext}
                  segmentLabel={tI18n('for_growing_teams')}
                  credits={PRO_PLAN_CREDITS.credits}
                  refresh={PRO_PLAN_CREDITS.refresh}
                  features={PRO_PLAN_FEATURES}
                  buttonText={proCta.label}
                  onButtonClick={proCta.onClick}
                  buttonDisabled={proCta.disabled}
                  highlighted={proCta.variant === 'primary'}
                  bannerText={proBanner}
                />

                <UpgradePlanCard
                  name='Max'
                  price={`$${maxPrice}`}
                  discountLabel={state.isAnnual ? `${discountPct}% off` : undefined}
                  priceSubtext={priceSubtext}
                  segmentLabel={tI18n('for_scaling_businesses')}
                  credits={MAX_PLAN_CREDITS.credits}
                  refresh={MAX_PLAN_CREDITS.refresh}
                  features={MAX_PLAN_FEATURES}
                  buttonText={maxCta.label}
                  onButtonClick={maxCta.onClick}
                  buttonDisabled={maxCta.disabled}
                  highlighted={maxCta.variant === 'primary'}
                  bannerText={maxBanner}
                />

                <UpgradePlanCard
                  name='Enterprise'
                  price='Custom'
                  segmentLabel={tI18n('for_large_organizations')}
                  credits={ENTERPRISE_PLAN_CREDITS.credits}
                  refresh={ENTERPRISE_PLAN_CREDITS.refresh}
                  features={ENTERPRISE_PLAN_FEATURES}
                  buttonText={enterpriseCta.label}
                  onButtonClick={enterpriseCta.onClick}
                  buttonDisabled={enterpriseCta.disabled}
                  highlighted={enterpriseCta.variant === 'primary'}
                />
              </div>

              {/* Show / Hide all features */}
              <div className='flex flex-col items-center gap-6'>
                <Chip
                  onClick={() => setShowAllFeatures((prev) => !prev)}
                  aria-expanded={showAllFeatures}
                >
                  {showAllFeatures ? tI18n('hide_all_features') : tI18n('show_all_features')}
                </Chip>

                {showAllFeatures && (
                  <ComparisonTable
                    proPrice={`$${proPrice}`}
                    maxPrice={`$${maxPrice}`}
                    isAnnual={state.isAnnual}
                    onIsAnnualChange={state.setIsAnnual}
                    ctas={comparisonCtas}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
