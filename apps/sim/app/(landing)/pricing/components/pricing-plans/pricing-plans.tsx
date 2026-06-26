'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { getUpgradeCardCta, type PlanTier, type UpgradeCardId } from '@/lib/billing/client'
import { ANNUAL_DISCOUNT_RATE, CREDIT_TIERS } from '@/lib/billing/constants'
import {
  PricingCard,
  type PricingCardCta,
  type PricingCardSection,
} from '@/app/(landing)/pricing/components/pricing-card'
import { BillingPeriodToggle } from '@/app/workspace/[workspaceId]/upgrade/components'
import {
  type CellValue,
  COMPARISON_SECTIONS,
} from '@/app/workspace/[workspaceId]/upgrade/components/comparison-table/comparison-data'

/**
 * A public visitor has no subscription, so each card's canonical label and
 * variant resolves against the `free` tier. On this page every CTA funnels to
 * sign-up regardless of plan.
 */
const VISITOR_TIER: PlanTier = 'free'

/** Every CTA on the public pricing page funnels logged-out visitors to sign-up. */
const SIGNUP_HREF = '/signup'

/**
 * Props for {@link PricingPlans}.
 */
export interface PricingPlansProps {
  /**
   * Server-rendered heading slot — the page `<h1>` and its sr-only GEO summary.
   * Passed as a slot so the crawlable copy stays in the server payload.
   */
  heading: ReactNode
}

/**
 * Transpose the shared comparison data into one plan column's feature sections,
 * so each card carries the full breakdown for its plan without duplicating it.
 */
function sectionsForColumn(col: number): PricingCardSection[] {
  return COMPARISON_SECTIONS.map((section) => ({
    title: section.title,
    rows: section.rows.map((row) => ({ label: row.label, value: row.values[col] as CellValue })),
  }))
}

/**
 * The single interactive island of the public pricing page. It owns the lone
 * piece of state — `isAnnual`, defaulting to monthly — which the billing-period
 * toggle (centered under the heading) and the Pro/Max card prices read from one
 * source.
 *
 * Each plan (Free, Pro, Max, Enterprise) renders as a full {@link PricingCard}
 * spec sheet in a four-up grid that renders at exactly the same height. Prices
 * and the discount come from {@link CREDIT_TIERS} / {@link ANNUAL_DISCOUNT_RATE},
 * the feature breakdown is transposed from the shared `COMPARISON_SECTIONS`, and
 * the CTA labels/variants from {@link getUpgradeCardCta}. Every CTA, Free
 * included, funnels to `/signup`.
 */
export function PricingPlans({ heading }: PricingPlansProps) {
  const [isAnnual, setIsAnnual] = useState(false)

  const discountPct = Math.round(ANNUAL_DISCOUNT_RATE * 100)
  const proPrice = isAnnual
    ? Math.round(CREDIT_TIERS[0].dollars * (1 - ANNUAL_DISCOUNT_RATE))
    : CREDIT_TIERS[0].dollars
  const maxPrice = isAnnual
    ? Math.round(CREDIT_TIERS[1].dollars * (1 - ANNUAL_DISCOUNT_RATE))
    : CREDIT_TIERS[1].dollars
  const priceSubtext = isAnnual
    ? 'per user/month, billed annually'
    : 'per user/month, billed monthly'
  const discountLabel = isAnnual ? `${discountPct}% off` : undefined

  /**
   * Resolve a card's canonical label and variant from the free-tier matrix; the
   * CTA always funnels logged-out visitors to sign-up.
   */
  const resolveCta = (card: UpgradeCardId): PricingCardCta => {
    const cta = getUpgradeCardCta(VISITOR_TIER, card)
    return { label: cta.label, variant: cta.variant, href: SIGNUP_HREF }
  }

  const freeCta: PricingCardCta = {
    label: 'Get started',
    variant: 'border-shadow',
    href: SIGNUP_HREF,
  }
  const proCta = resolveCta('pro')
  const maxCta = resolveCta('max')
  const enterpriseCta = resolveCta('enterprise')

  return (
    <>
      <div className='flex flex-col items-center gap-4'>
        {heading}
        <BillingPeriodToggle isAnnual={isAnnual} onChange={setIsAnnual} />
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <PricingCard
          name='Free'
          price='$0'
          priceSubtext='Free forever'
          cta={freeCta}
          sections={sectionsForColumn(0)}
        />
        <PricingCard
          name='Pro'
          price={`$${proPrice}`}
          discountLabel={discountLabel}
          priceSubtext={priceSubtext}
          cta={proCta}
          sections={sectionsForColumn(1)}
        />
        <PricingCard
          name='Max'
          price={`$${maxPrice}`}
          discountLabel={discountLabel}
          priceSubtext={priceSubtext}
          cta={maxCta}
          sections={sectionsForColumn(2)}
        />
        <PricingCard
          name='Enterprise'
          price='Custom'
          priceSubtext='Tailored to your team'
          cta={enterpriseCta}
          sections={sectionsForColumn(3)}
        />
      </div>
    </>
  )
}
