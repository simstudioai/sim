import type { Principal } from '@sim/auth/principal'
import type { ComputerUseOwner } from '@/lib/api/contracts/computer-use'
import { isComputerUseAvailable } from '@/lib/computer-use/availability.server'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { defineAuthorizedOrganizationUseCase } from '@/lib/core/application/authorized-organization-use-case'
import {
  assertOperationPrincipal,
  defineOperation,
  type OperationUseCase,
} from '@/lib/core/application/operation'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/** permission-group-exempt: reports the rollout for a workspace the caller can read; actions require chat authorization. */
const workspaceAvailabilityOperation = defineWorkspaceOperation({
  id: 'desktop.computer.availability',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'none',
  principalKinds: ['session'],
})

/** permission-group-exempt: reports the rollout for an organization the caller belongs to; actions require chat authorization. */
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
  execute: ({ context }) => isComputerUseAvailable(context.workspaceOrganizationId),
})

const organizationAvailability = defineAuthorizedOrganizationUseCase({
  operation: organizationAvailabilityOperation,
  execute: ({ input }: { input: { organizationId: string } }) =>
    isComputerUseAvailable(input.organizationId),
})

/**
 * Whether computer use is rolled out for a chat's owner: an organization chat follows its
 * organization, a workspace chat its workspace's organization, and a personal workspace the
 * global switch.
 */
export function isComputerUseAvailableFor(
  principal: Principal,
  owner: ComputerUseOwner
): Promise<boolean> {
  return 'organizationId' in owner
    ? organizationAvailability.execute({ principal, input: owner })
    : workspaceAvailability.execute({ principal, input: owner })
}

/** permission-group-exempt: dispatches to the owner's authorized rollout read above. */
const availabilityOperation = defineOperation({
  id: 'desktop.computer.availability',
  capability: 'none',
  principalKinds: ['session'],
})

/** The desktop's rollout read before it touches the native helper; no device or app data leaves the desktop. */
export const readComputerUseAvailability: OperationUseCase<
  typeof availabilityOperation,
  ComputerUseOwner,
  { enabled: boolean }
> = {
  operation: availabilityOperation,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, availabilityOperation)
    return { enabled: await isComputerUseAvailableFor(principal, input) }
  },
}
