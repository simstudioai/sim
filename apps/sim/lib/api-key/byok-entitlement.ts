import { resolveOrganizationEnterprisePlan } from '@/lib/billing/core/subscription'
import { isHosted } from '@/lib/core/config/env-flags'

/** Organization BYOK is a Sim Cloud Enterprise entitlement. */
export async function isOrganizationBYOKEntitled(organizationId: string): Promise<boolean> {
  return isHosted && (await resolveOrganizationEnterprisePlan(organizationId))
}
