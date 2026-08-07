import { getActiveWorkflowContext } from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import {
  v2AddWorkflowGroupContract,
  v2DeleteWorkflowGroupContract,
  v2ListWorkflowGroupsContract,
  v2UpdateWorkflowGroupContract,
} from '@/lib/api/contracts/v2/tables'
import type { TableDefinition, TableSchema } from '@/lib/table'
import { signalTableSchemaChanged } from '@/lib/table/events'
import {
  addWorkflowGroup,
  deleteWorkflowGroup,
  updateWorkflowGroup,
} from '@/lib/table/workflow-groups/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess, normalizeColumn } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2CursorList, v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'
import { v2TableLockError } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/tables/[tableId]/groups — The table's workflow/enrichment groups.
 *
 * Read-only: groups are authored in the workflow builder, and the public
 * surface exposes them so a caller can discover the `groupIds` the run
 * endpoints take. Groups live on the table's schema, so this is a projection of
 * the already-loaded definition rather than a second query, and the set is
 * bounded per table — one full page, `nextCursor` always `null`.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2ListWorkflowGroupsContract,
  rateLimitEndpoint: 'table-groups',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { tableId } = input.params
    const { workspaceId } = input.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!result.ok || result.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const groups = (result.table.schema as TableSchema).workflowGroups ?? []

    return v2CursorList(groups, null, { rateLimit })
  },
})

/**
 * Maps expected group-service failures into the v2 envelope. The service
 * signals through thrown `Error` messages rather than classified codes, so the
 * string matching mirrors the first-party mapper. Unexpected errors keep
 * bubbling to the public route wrapper for centralized logging and rendering.
 */
function groupMutationError(error: unknown) {
  const lockError = v2TableLockError(error)
  if (lockError) return lockError

  if (error instanceof Error) {
    const message = error.message
    if (message === 'Table not found' || message.includes('not found')) {
      return v2Error('NOT_FOUND', message)
    }
    if (
      message.includes('Schema validation') ||
      message.includes('Missing column definition') ||
      message.includes('already exists') ||
      message.includes('exceed')
    ) {
      return v2Error('BAD_REQUEST', message)
    }
  }

  throw error
}

/**
 * A group persists a `workflowId` that its runs later execute. Without this the
 * table becomes a way to invoke workflows the API key cannot otherwise reach,
 * so containment is asserted before the id is stored — on create and on any
 * update that re-points the group.
 */
async function assertWorkflowInWorkspace(workflowId: string, workspaceId: string) {
  const context = await getActiveWorkflowContext(workflowId)
  if (!context || context.workspaceId !== workspaceId) {
    return v2Error('BAD_REQUEST', 'Workflow not found in this workspace')
  }
  return null
}

/**
 * `{ group, columns }` for the group a mutation touched.
 *
 * Throws when the write reports success but the group is absent from the
 * returned schema. The contract declares `group` as present, so emitting
 * `undefined` there would ship a body no client can parse while reporting 200 —
 * an internal inconsistency is worth a 500, not a malformed success.
 */
function groupResponse(table: TableDefinition, groupId: string) {
  const schema = table.schema as TableSchema
  const group = (schema.workflowGroups ?? []).find((candidate) => candidate.id === groupId)
  if (!group) {
    throw new Error(`Workflow group ${groupId} missing from the table after a successful write`)
  }
  return { group, columns: schema.columns.map(normalizeColumn) }
}

/**
 * POST /api/v2/tables/[tableId]/groups — Bind a workflow or enrichment to the
 * table and create the columns its runs populate, in one call.
 */
export const POST = withPublicApiRouteHandler({
  contract: v2AddWorkflowGroupContract,
  rateLimitEndpoint: 'table-groups',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const validated = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok || result.table.workspaceId !== validated.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      if (validated.group.workflowId) {
        const workflowError = await assertWorkflowInWorkspace(
          validated.group.workflowId,
          result.table.workspaceId
        )
        if (workflowError) return workflowError
      }

      /**
       * `outputs` and `outputColumns` are two arrays joined by column name, so a
       * typo in either silently creates a column nothing feeds. The first-party
       * client builds both from one picker and can't desync; a public caller can,
       * so the mismatch is rejected rather than persisted.
       */
      const outputNames = new Set(validated.group.outputs.map((output) => output.columnName))
      const orphan = validated.outputColumns.find((column) => !outputNames.has(column.name))
      if (orphan) {
        return v2Error(
          'BAD_REQUEST',
          `outputColumns entry "${orphan.name}" has no matching group.outputs[].columnName`
        )
      }

      const groupId = validated.group.id ?? generateId()

      const updatedTable = await addWorkflowGroup(
        {
          tableId,
          group: { ...validated.group, id: groupId },
          // Stamped from the resolved group rather than trusted from the caller.
          outputColumns: validated.outputColumns.map((column) => ({
            ...column,
            workflowGroupId: groupId,
          })),
          autoRun: validated.autoRun,
          actorUserId: userId,
        },
        requestId
      )

      signalTableSchemaChanged(tableId)

      return v2Data(groupResponse(updatedTable, groupId), { rateLimit, status: 201 })
    } catch (error) {
      return groupMutationError(error)
    }
  },
})

/**
 * PATCH /api/v2/tables/[tableId]/groups — Restructure a group: re-point it,
 * add or remove outputs, or change how its runs are scheduled.
 *
 * Removing an output **deletes that column and its values** — the same
 * behavior as `DELETE /columns` on a bound column. There is no detach.
 */
export const PATCH = withPublicApiRouteHandler({
  contract: v2UpdateWorkflowGroupContract,
  rateLimitEndpoint: 'table-groups',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const validated = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok || result.table.workspaceId !== validated.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      if (validated.workflowId !== undefined) {
        const workflowError = await assertWorkflowInWorkspace(
          validated.workflowId,
          result.table.workspaceId
        )
        if (workflowError) return workflowError
      }

      const updatedTable = await updateWorkflowGroup(
        {
          tableId,
          groupId: validated.groupId,
          actorUserId: userId,
          ...(validated.workflowId !== undefined ? { workflowId: validated.workflowId } : {}),
          ...(validated.name !== undefined ? { name: validated.name } : {}),
          ...(validated.dependencies !== undefined ? { dependencies: validated.dependencies } : {}),
          ...(validated.outputs !== undefined ? { outputs: validated.outputs } : {}),
          ...(validated.newOutputColumns !== undefined
            ? {
                newOutputColumns: validated.newOutputColumns.map((column) => ({
                  ...column,
                  workflowGroupId: validated.groupId,
                })),
              }
            : {}),
          ...(validated.mappingUpdates !== undefined
            ? { mappingUpdates: validated.mappingUpdates }
            : {}),
          ...(validated.inputMappings !== undefined
            ? { inputMappings: validated.inputMappings }
            : {}),
          ...(validated.deploymentMode !== undefined
            ? { deploymentMode: validated.deploymentMode }
            : {}),
          ...(validated.type !== undefined ? { type: validated.type } : {}),
          ...(validated.autoRun !== undefined ? { autoRun: validated.autoRun } : {}),
        },
        requestId
      )

      signalTableSchemaChanged(tableId)

      return v2Data(groupResponse(updatedTable, validated.groupId), { rateLimit })
    } catch (error) {
      return groupMutationError(error)
    }
  },
})

/**
 * DELETE /api/v2/tables/[tableId]/groups — Remove a group **and every column it
 * fed**, along with their values. The surviving column list comes back so a
 * caller does not have to re-read the table to see what is left.
 */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteWorkflowGroupContract,
  rateLimitEndpoint: 'table-groups',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const validated = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok || result.table.workspaceId !== validated.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const updatedTable = await deleteWorkflowGroup(
        { tableId, groupId: validated.groupId },
        requestId
      )

      signalTableSchemaChanged(tableId)

      return v2Data(
        {
          id: validated.groupId,
          deleted: true as const,
          columns: (updatedTable.schema as TableSchema).columns.map(normalizeColumn),
        },
        { rateLimit }
      )
    } catch (error) {
      return groupMutationError(error)
    }
  },
})
