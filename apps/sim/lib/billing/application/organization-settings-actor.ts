import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'

/** Bounded Copilot access is the acting administrator's grant, never the organization's payer. */
export async function organizationBillingSettingsActor(
  principal: Extract<Principal, { kind: 'session' | 'organization_delegated' }>,
  operation: ApplicationOperation,
  organizationId: string
): Promise<string> {
  if (principal.kind === 'session') return principal.userId
  const context = await authorizeOrganizationOperation(
    principal,
    {
      ...operation,
      minimumRole: 'admin',
      principalKinds: ['organization_delegated'],
      delegationAudience: 'sim:settings',
      delegatedServices: ['copilot'],
    },
    { organizationId }
  )
  return context.userId
}
