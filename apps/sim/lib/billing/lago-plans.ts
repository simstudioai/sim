import { LAGO_PLAN_CODES } from '@/lib/billing/lago/config'

/**
 * Mapping from SIM plan names to Lago plan codes.
 * Used to check whether a given SIM plan has a corresponding Lago plan.
 */
export const SIM_TO_LAGO_PLAN: Record<string, string> = {
  free: LAGO_PLAN_CODES.free,
  pro_6000: LAGO_PLAN_CODES.pro_6000,
  pro_25000: LAGO_PLAN_CODES.pro_25000,
  team_6000: LAGO_PLAN_CODES.team_6000,
  team_25000: LAGO_PLAN_CODES.team_25000,
  enterprise: LAGO_PLAN_CODES.enterprise,
}

/**
 * Returns `true` when the given SIM plan name has a Lago plan counterpart.
 */
export function isLagoPlan(planName: string): boolean {
  return !!SIM_TO_LAGO_PLAN[planName]
}
