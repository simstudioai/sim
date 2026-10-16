import { RESOURCE_SEARCH_TYPES, type ResourceSearchType } from '@/lib/api/contracts/resource-search'
import type { CursorKey } from '@/lib/api/list-query'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import type { WorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { tableOperations } from '@/lib/table/application/operations'
import { workflowTestOperations } from '@/lib/workflow-tests/application/operations'
import {
  isWorkflowTestsEnabled,
  requireWorkflowTestsEnabled,
} from '@/lib/workflow-tests/feature-flag'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { searchResourceNames } from '@/lib/workspaces/resource-search'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

export const organizationResourceOperations = {
  // permission-group-exempt: spans several resource types, so the use case applies each type's own capability per workspace instead
  search: defineOrganizationOperation({
    id: 'organization.resources.search',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const

/** Each type's own list operation, whose capability gates the type in each workspace here too. */
const LIST_OPERATION_BY_TYPE: Record<ResourceSearchType, WorkspaceOperation> = {
  workflow: workflowOperations.list,
  table: tableOperations.list,
  file: fileOperations.list,
  knowledgebase: knowledgeOperations.list,
  test: workflowTestOperations.read,
}

/**
 * The requested types, or every type when none are. Tests are an organization-level feature: left
 * out of an unscoped search when off, and refused, as their own list refuses, when asked for.
 */
async function searchableTypes(
  requested: readonly ResourceSearchType[] | undefined,
  organizationId: string
): Promise<readonly ResourceSearchType[]> {
  const types = requested?.length ? requested : RESOURCE_SEARCH_TYPES
  if (!types.includes('test')) return types
  if (requested?.includes('test')) {
    await requireWorkflowTestsEnabled(organizationId)
    return types
  }
  return (await isWorkflowTestsEnabled(organizationId))
    ? types
    : types.filter((type) => type !== 'test')
}

export interface SearchOrganizationResourcesInput {
  organizationId: string
  search?: string
  types?: readonly ResourceSearchType[]
  /** Narrows the search to these workspaces; any the viewer cannot open are ignored. */
  workspaceIds?: readonly string[]
  limit: number
  cursorKeys?: CursorKey[]
}

/**
 * Active resources named like `search` across the organization's workspaces the viewer can
 * open: the same workspaces the organization workspace list returns, each type limited to the
 * workspaces whose permission group grants that type's own list capability.
 */
export const searchOrganizationResources = defineAuthorizedOrganizationUseCase({
  operation: organizationResourceOperations.search,
  async execute({ input, context }: OrganizationUseCaseContext<SearchOrganizationResourcesInput>) {
    const rows = await listAccessibleWorkspaceRowsForUser(
      context.userId,
      'active',
      context.organizationId
    )
    const workspaceIds = rows
      .filter(
        ({ workspace }) =>
          workspace.organizationId === context.organizationId &&
          (!input.workspaceIds?.length || input.workspaceIds.includes(workspace.id))
      )
      .map(({ workspace }) => workspace.id)
    const types = await searchableTypes(input.types, context.organizationId)
    const allowedTypes = await mapWithConcurrency(workspaceIds, 8, async (workspaceId) => {
      const config = await resolvePermissionGroupConfig(
        context.userId,
        workspaceId,
        context.organizationId
      )
      return types.filter((type) => {
        const { capability } = LIST_OPERATION_BY_TYPE[type]
        return capability === 'none' || !capabilityDeniedBy(capability, config)
      })
    })
    const workspaceIdsByType = new Map<ResourceSearchType, string[]>(
      types.map((type) => [type, []])
    )
    workspaceIds.forEach((workspaceId, index) => {
      for (const type of allowedTypes[index]) workspaceIdsByType.get(type)?.push(workspaceId)
    })
    return searchResourceNames({
      workspaceIdsByType,
      search: input.search,
      limit: input.limit,
      cursorKeys: input.cursorKeys,
    })
  },
})
