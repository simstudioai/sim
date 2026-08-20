import { resolveOrganizationPlan } from '@/lib/billing/core/subscription'
import { isHosted } from '@/lib/core/config/env-flags'

/**
 * Organization BYOK is available to every paying organization on Sim Cloud —
 * Pro for Teams, Max for Teams, and Enterprise — since an organization is the
 * only thing that can hold the keys. It is not an Enterprise-only entitlement.
 */
export async function isOrganizationBYOKEntitled(organizationId: string): Promise<boolean> {
  return isHosted && (await resolveOrganizationPlan(organizationId))
}
