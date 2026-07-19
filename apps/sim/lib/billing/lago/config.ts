import { getLagoProductSlug } from '@/lib/billing/lago/product'
import { env } from '@/lib/core/config/env'

const productSlug = getLagoProductSlug()
const defaultFreePlan = productSlug ? `${productSlug}_free` : 'sim_free'
const paygPlanCode = productSlug ? `${productSlug}_payg` : 'sim_free'

export const LAGO_BILLING_METRIC_CODE =
  env.LAGO_BILLABLE_METRIC_CODE?.trim() || (productSlug ? 'llm_cost' : 'workflow_credits')

export const LAGO_PLAN_CODES = {
  free: env.LAGO_PLAN_FREE?.trim() || defaultFreePlan,
  pro_6000: env.LAGO_PLAN_PRO_6000?.trim() || 'sim_pro_6000',
  pro_25000: env.LAGO_PLAN_PRO_25000?.trim() || 'sim_pro_25000',
  team_6000: env.LAGO_PLAN_TEAM_6000?.trim() || 'sim_team_6000',
  team_25000: env.LAGO_PLAN_TEAM_25000?.trim() || 'sim_team_25000',
  enterprise: env.LAGO_PLAN_ENTERPRISE?.trim() || 'sim_enterprise',
} as const

const LAGO_PLAN_TO_SIM: Record<string, string> = {
  [LAGO_PLAN_CODES.free]: 'free',
  [LAGO_PLAN_CODES.pro_6000]: 'pro_6000',
  [LAGO_PLAN_CODES.pro_25000]: 'pro_25000',
  [LAGO_PLAN_CODES.team_6000]: 'team_6000',
  [LAGO_PLAN_CODES.team_25000]: 'team_25000',
  [LAGO_PLAN_CODES.enterprise]: 'enterprise',
}

if (paygPlanCode !== LAGO_PLAN_CODES.free) {
  LAGO_PLAN_TO_SIM[paygPlanCode] = 'free'
}

const SIM_PLAN_TO_LAGO: Record<string, string> = Object.fromEntries(
  Object.entries(LAGO_PLAN_TO_SIM).map(([lago, sim]) => [sim, lago])
)

/**
 * Maps a Lago plan code to the Sim subscription plan name stored in the DB.
 */
export function mapLagoPlanToSimPlan(planCode: string | null | undefined): string {
  if (!planCode) return 'free'
  return LAGO_PLAN_TO_SIM[planCode] ?? planCode
}

/**
 * Maps a Sim plan name to the Lago plan code configured for this deployment.
 */
export function mapSimPlanToLagoPlan(planName: string): string | undefined {
  return SIM_PLAN_TO_LAGO[planName]
}
