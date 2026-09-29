import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isMemorySpacesEnabled } from '@/lib/mothership/feature-flags'
import { changeMemorySpace, listMemorySpaceRecords } from '@/lib/mothership/memory/spaces'

const policy = {
  minimumRole: 'member',
  principalKinds: ['session'],
} as const
export const memorySpaceOperations = {
  list: defineOrganizationOperation({
    id: 'mothership.memory.spaces.list',
    ...policy,
    capability: 'copilot.use',
  }),
  create: defineOrganizationOperation({
    id: 'mothership.memory.spaces.create',
    ...policy,
    capability: 'copilot.use',
  }),
  select: defineOrganizationOperation({
    id: 'mothership.memory.spaces.select',
    ...policy,
    capability: 'copilot.use',
  }),
}

interface ListSpacesInput {
  organizationId: string
}
interface CreateSpaceInput extends ListSpacesInput {
  name: string
}
interface SelectSpaceInput extends ListSpacesInput {
  spaceId: string | null
}

async function requireAvailable() {
  if (!(await isMemorySpacesEnabled()))
    throw new OrchestrationError('not_found', 'Knowledge graph settings are unavailable')
}

export const listMemorySpaces = defineAuthorizedOrganizationUseCase({
  operation: memorySpaceOperations.list,
  authorizeResource: requireAvailable,
  execute: ({ context }: OrganizationUseCaseContext<ListSpacesInput>) =>
    listMemorySpaceRecords(context),
})
export const createMemorySpace = defineAuthorizedOrganizationUseCase({
  operation: memorySpaceOperations.create,
  authorizeResource: requireAvailable,
  execute: ({ context, input }: OrganizationUseCaseContext<CreateSpaceInput>) =>
    changeMemorySpace(context, { name: input.name }),
})
export const selectMemorySpace = defineAuthorizedOrganizationUseCase({
  operation: memorySpaceOperations.select,
  authorizeResource: requireAvailable,
  execute: ({ context, input }: OrganizationUseCaseContext<SelectSpaceInput>) =>
    changeMemorySpace(context, { spaceId: input.spaceId }),
})
