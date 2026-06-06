import { CREDIT_TIERS } from '@/lib/billing/constants'
import { getPlanTierCredits, isEnterprise, isFree, isPaid } from '@/lib/billing/plan-helpers'

/**
 * Canonical client-side plan abstraction.
 *
 * Single source of truth for the plan-derived UI decisions shared across the
 * upgrade page, the home credits chip, the sidebar usage indicator, and the
 * settings billing page: which tier the user is on, the per-card CTA on the
 * upgrade page, whether the upgrade page is accessible, and whether credit
 * balances should be shown.
 *
 * Pure and framework-free — see {@link usePlanView} for the React Query wrapper.
 */

/** Credit-tier-resolved plan identity used to drive upgrade-page UI. */
export type PlanTier = 'free' | 'pro' | 'max' | 'enterprise'

/** The three plan cards rendered on the upgrade page. */
export type UpgradeCardId = 'pro' | 'max' | 'enterprise'

/** Chip variant a card's CTA renders with. */
export type CtaVariant = 'primary' | 'border-shadow'

/** What activating a card's CTA does, mapped to a handler by the consumer. */
export type CtaIntent = 'upgrade' | 'downgrade' | 'manage' | 'sales'

/** Plan-derived CTA descriptor for a single upgrade card. */
export interface PlanCardCta {
  label: string
  variant: CtaVariant
  intent: CtaIntent
  /** True when this card is the highlighted next step up from the current plan. */
  highlighted: boolean
}

/** Plan-derived view consumed by every billing surface. */
export interface PlanView {
  tier: PlanTier
  isFree: boolean
  isPaid: boolean
  isEnterprise: boolean
  /** Enterprise manages billing out-of-band — it cannot use the self-serve upgrade page. */
  canAccessUpgrade: boolean
  /** Credit balances are meaningless for enterprise (custom limits) and are hidden. */
  showCredits: boolean
}

const MAX_TIER_CREDITS = CREDIT_TIERS[1].credits

/** Tier ordering used to derive upgrade/downgrade/highlight relationships. */
const PLAN_RANK: Record<PlanTier, number> = { free: 0, pro: 1, max: 2, enterprise: 3 }

/**
 * Resolve a plan name to its credit-tier identity. Paid pro/team plans split
 * into `pro` / `max` by their credit allocation (>= 25k credits => Max).
 */
export function resolvePlanTier(plan: string | null | undefined): PlanTier {
  if (isEnterprise(plan)) return 'enterprise'
  if (isFree(plan)) return 'free'
  return getPlanTierCredits(plan) >= MAX_TIER_CREDITS ? 'max' : 'pro'
}

/**
 * Derive the CTA for a single upgrade card given the current plan tier.
 *
 * The highlighted (primary) card is always the immediate next step up from the
 * current tier. The same-tier card reads "Current Plan" (a non-actionable
 * marker — plan management lives on the Billing settings page) and lower-tier
 * cards offer "Downgrade plan" (a secondary `border-shadow` chip). A higher card
 * reads "Get started" only while the user has no paid plan yet; once they are on
 * a paid tier it becomes an explicit "Upgrade plan".
 */
export function getUpgradeCardCta(current: PlanTier, card: UpgradeCardId): PlanCardCta {
  const isNextStepUp = PLAN_RANK[card] === PLAN_RANK[current] + 1

  if (card === 'enterprise') {
    return {
      label: 'Talk to sales',
      variant: isNextStepUp ? 'primary' : 'border-shadow',
      intent: 'sales',
      highlighted: isNextStepUp,
    }
  }

  if (PLAN_RANK[current] === PLAN_RANK[card]) {
    return { label: 'Current Plan', variant: 'border-shadow', intent: 'manage', highlighted: false }
  }

  if (PLAN_RANK[current] > PLAN_RANK[card]) {
    return {
      label: 'Downgrade plan',
      variant: 'border-shadow',
      intent: 'downgrade',
      highlighted: false,
    }
  }

  return {
    label: current === 'free' ? 'Get started' : 'Upgrade plan',
    variant: isNextStepUp ? 'primary' : 'border-shadow',
    intent: 'upgrade',
    highlighted: isNextStepUp,
  }
}

/** Derive the shared plan view from a plan name. */
export function derivePlanView(plan: string | null | undefined): PlanView {
  const enterprise = isEnterprise(plan)
  return {
    tier: resolvePlanTier(plan),
    isFree: isFree(plan),
    isPaid: isPaid(plan),
    isEnterprise: enterprise,
    canAccessUpgrade: !enterprise,
    showCredits: !enterprise,
  }
}
