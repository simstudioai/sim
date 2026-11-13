import type { Principal } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { defineAuthorizedOrganizationUseCase } from '@/lib/core/application/authorized-organization-use-case'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import {
  isOrganizationCapabilityWithheld,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/** permission-group-exempt: reports whether computer_use.use is withheld instead of refusing; actions declare it. */
const workspaceAvailabilityOperation = defineWorkspaceOperation({
  id: 'desktop.computer.availability',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'none',
  principalKinds: ['session'],
})

/** permission-group-exempt: reports whether computer_use.use is withheld instead of refusing; actions declare it. */
const organizationAvailabilityOperation = defineOrganizationOperation({
  id: 'desktop.computer.availability',
  minimumRole: 'member',
  capability: 'none',
  principalKinds: ['session'],
})

const workspaceAvailability = defineAuthorizedWorkspaceUseCase({
  operation: workspaceAvailabilityOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }) =>
    // permission-group-enforced: computer_use.use — an availability read answers false rather than 403
    !(await isWorkspaceCapabilityWithheld(
      principal.userId,
      input.workspaceId,
      'computer_use.use',
      context.workspaceOrganizationId
    )),
})

const organizationAvailability = defineAuthorizedOrganizationUseCase({
  operation: organizationAvailabilityOperation,
  execute: async ({ input }: { input: { organizationId: string } }) =>
    // permission-group-enforced: computer_use.use — an availability read answers false rather than 403
    !(await isOrganizationCapabilityWithheld(input.organizationId, 'computer_use.use')),
})

/** The chat whose permission group applies: exactly one of a workspace or an organization. */
type ComputerUseOwner = { workspaceId: string } | { organizationId: string }

/**
 * Whether the chat owner's permission group allows computer use: an organization chat follows
 * its organization's default group, a workspace chat the group governing that workspace.
 */
export function isComputerUseAvailableFor(
  principal: Principal,
  owner: ComputerUseOwner
): Promise<boolean> {
  return 'organizationId' in owner
    ? organizationAvailability.execute({ principal, input: owner })
    : workspaceAvailability.execute({ principal, input: owner })
}
