import type { OperationUseCase } from '@/lib/core/application'
import { assertOperationPrincipal, defineOperation } from '@/lib/core/application/operation'
import { createPersonalOrganization } from '@/lib/organizations/provision-personal'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'

const viewerOrganizationOperations = {
  // permission-group-exempt: puts the signed-in person into their own organization; it grants nothing in anyone else's and no group governs a person's own landing
  ensure: defineOperation({
    id: 'organizations.viewer.ensure',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const

/**
 * The organization the signed-in viewer lands in, provisioning their personal organization first
 * when they belong to none. Idempotent, and a no-op write for anyone already in an organization.
 * Covers a signup whose provisioning failed, an account the backfill has not reached, and someone
 * who left a team. It never joins the instance organization: only signup does, so a member removed
 * from it (by an admin, the Admin API, or SCIM deprovisioning that keeps the account) stays in their
 * personal organization. Accounts from before instance mode was enabled join through the backfill
 * script, an operator action. Returns null only for an account that no longer exists.
 *
 * The one command that provisions an organization lazily; its callers are the product shell's
 * landing read and workspace creation, both of which need the viewer to be in an organization.
 */
export const ensureViewerOrganization: OperationUseCase<
  typeof viewerOrganizationOperations.ensure,
  Record<string, never>,
  string | null
> = {
  operation: viewerOrganizationOperations.ensure,
  async execute({ principal }) {
    assertOperationPrincipal(principal, viewerOrganizationOperations.ensure)
    const landing = await resolveOrganizationLanding(principal.userId, null)
    return landing ?? createPersonalOrganization(principal.userId)
  },
}
