import {
  RECENTLY_DELETED_TYPES_BY_FILTER,
  type RecentlyDeletedFilter,
  type RecentlyDeletedItem,
  type RecentlyDeletedSortColumn,
} from '@/lib/api/contracts/recently-deleted'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import {
  defineWorkspaceOperation,
  type WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import type { StaticPermissionGroupCapability } from '@/lib/permission-groups/capabilities'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { tableOperations } from '@/lib/table/application/operations'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { listRecentlyDeletedItems } from '@/lib/workspaces/recently-deleted'

type RecentlyDeletedType = RecentlyDeletedItem['type']

export const recentlyDeletedOperations = {
  // permission-group-exempt: spans several resource types, so the use case applies each type's own capability to its rows instead
  list: defineWorkspaceOperation({
    id: 'workspaces.recently_deleted.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const

/**
 * Each type's own list operation, whose capability gates the type here too. A type whose
 * capability the viewer's permission group withholds is left out of the page, folders with it.
 */
const LIST_OPERATION_BY_TYPE: Partial<Record<RecentlyDeletedType, WorkspaceOperation>> = {
  table: tableOperations.list,
  table_folder: tableOperations.list,
  knowledge: knowledgeOperations.list,
  knowledge_folder: knowledgeOperations.list,
  file: fileOperations.list,
  workspace_folder: fileOperations.list,
}

function capabilityFor(type: RecentlyDeletedType): StaticPermissionGroupCapability | undefined {
  const capability = LIST_OPERATION_BY_TYPE[type]?.capability
  return capability === 'none' ? undefined : capability
}

export interface ListRecentlyDeletedInput {
  workspaceId: string
  filter: RecentlyDeletedFilter
  search?: string
  sortBy: RecentlyDeletedSortColumn
  sortOrder: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}

/**
 * One page of a workspace's Recently Deleted view across every resource type: workspace
 * read access, each type's own capability, and chats limited to the viewer's own — the
 * same rules the per-type archived lists apply.
 */
export const listRecentlyDeleted = defineAuthorizedWorkspaceUseCase({
  operation: recentlyDeletedOperations.list,
  resolveContext: ({ input }: { input: ListRecentlyDeletedInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    const requested = RECENTLY_DELETED_TYPES_BY_FILTER[input.filter].filter(
      (type) => type !== 'chat' || isChatEnabled
    )
    const withheld = new Set<StaticPermissionGroupCapability>()
    await Promise.all(
      [...new Set(requested.flatMap((type) => capabilityFor(type) ?? []))].map(
        async (capability) => {
          const isWithheld = await isWorkspaceCapabilityWithheld(
            principal.userId,
            context.workspaceId,
            capability,
            context.workspaceOrganizationId
          )
          if (isWithheld) withheld.add(capability)
        }
      )
    )
    const types = new Set(
      requested.filter((type) => {
        const capability = capabilityFor(type)
        return !capability || !withheld.has(capability)
      })
    )
    return listRecentlyDeletedItems({
      workspaceId: context.workspaceId,
      types,
      chatUserId: principal.userId,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      limit: input.limit,
      cursorKeys: input.cursorKeys,
    })
  },
})
