import type { OperationUseCase } from '@/lib/core/application'
import { assertOperationPrincipal, defineOperation } from '@/lib/core/application/operation'
import { isInstanceOrganizationMode } from '@/lib/organizations/instance-org'
import { getPersonalOrganizationId } from '@/lib/organizations/personal'
import { ensureUserOrganization } from '@/lib/organizations/provision-personal'
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
 * The organization the signed-in viewer lands in, provisioning one first when they belong to none:
 * their personal organization, or the instance organization on an instance-organization deployment
 * (`ensureUserOrganization`). Idempotent, and a no-op write for anyone already in a team. Covers a
 * signup whose provisioning failed, an account the backfill has not reached, and someone who left
 * a team. On an instance-organization deployment a viewer still in their personal organization (a
 * signup whose instance join failed, or an account from before the mode was enabled) is moved into
 * the instance organization, which this never creates with the viewer as its owner. Returns null
 * only for an account that no longer exists.
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
    if (
      landing &&
      !(
        isInstanceOrganizationMode() &&
        landing === (await getPersonalOrganizationId(principal.userId))
      )
    ) {
      return landing
    }
    return ensureUserOrganization(principal.userId, { atSignup: false })
  },
}
