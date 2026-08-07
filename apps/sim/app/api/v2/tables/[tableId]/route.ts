import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  v2DeleteTableContract,
  v2GetTableContract,
  v2UpdateTableContract,
} from '@/lib/api/contracts/v2/tables'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { getTableById } from '@/lib/table'
import { signalTableSchemaChanged } from '@/lib/table/events'
import {
  performDeleteTable,
  performMoveTableToFolder,
  performRenameTable,
  performUpdateTableDescription,
} from '@/lib/table/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { folderPathForId, resolveFolderPathIdentity } from '@/app/api/v2/lib/folders'
import { v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'
import type { OrchestrationOutcome } from '@/app/api/v2/tables/utils'
import {
  toApiTable,
  v2TableAccessError,
  v2TableLockError,
  v2TableOrchestrationError,
} from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableDetailAPI')

/**
 * `details` payload naming the operations of a composite write that committed,
 * or `undefined` when none did — so `details.applied` being present always
 * means "these changes are live despite the error".
 */
function appliedDetails(
  applied: readonly ('name' | 'description' | 'folderPath')[]
): { applied: readonly string[] } | undefined {
  return applied.length > 0 ? { applied } : undefined
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/tables/[tableId] — Get table details. */
export const GET = withPublicApiRouteHandler({
  contract: v2GetTableContract,
  rateLimitEndpoint: 'table-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { tableId } = input.params
    const { workspaceId } = input.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!result.ok) return v2Error('NOT_FOUND', 'Table not found')

    if (result.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'table')
    return v2Data(
      { table: toApiTable(result.table, folderPathForId(folderIndex, result.table.folderId)) },
      { rateLimit }
    )
  },
})

/**
 * PATCH /api/v2/tables/[tableId] — Rename and/or move a table.
 *
 * Each field routes to its own orchestration call so the audit records the
 * operation the caller actually performed.
 *
 * Lock flags are **not** settable here. They are readable on the table resource
 * and enforced on every write, but an API key that can mutate a table must not
 * also be able to clear the lock placed there to stop it; changing a lock stays
 * a first-party admin action. The contract body is `.strict()`, so a request
 * carrying `locks` is rejected rather than silently ignored.
 */
export const PATCH = withPublicApiRouteHandler({
  contract: v2UpdateTableContract,
  rateLimitEndpoint: 'table-detail',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    /**
     * Hoisted above the `try` so every exit path can report it. Once a write has
     * committed, the response must say so even when the failure came *after* the
     * writes — a throw in the final re-read, or the re-read finding the table
     * archived. Reporting a bare 500 there tells the caller nothing landed, and
     * it retries into a duplicate-name conflict or a repeated move.
     */
    const applied: ('name' | 'description' | 'folderPath')[] = []

    try {
      const { tableId } = input.params
      const validated = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok) return v2TableAccessError(result)

      const { table } = result
      if (table.workspaceId !== validated.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const resolution =
        validated.folderPath === undefined
          ? undefined
          : await resolveFolderPathIdentity({
              workspaceId: table.workspaceId,
              resourceType: 'table',
              path: validated.folderPath,
            })
      if (resolution && !resolution.found) {
        return v2Error('NOT_FOUND', 'Folder not found in this workspace')
      }

      let failure: { outcome: OrchestrationOutcome; fallback: string } | null = null

      if (validated.name !== undefined) {
        const outcome = await performRenameTable({
          table,
          newName: validated.name,
          userId,
          requestId,
          request,
        })
        if (outcome.success) applied.push('name')
        else failure = { outcome, fallback: 'Failed to rename table' }
      }

      if (!failure && validated.description !== undefined) {
        const outcome = await performUpdateTableDescription({
          table,
          description: validated.description,
          userId,
          requestId,
          request,
        })
        if (outcome.success) applied.push('description')
        else failure = { outcome, fallback: 'Failed to update table description' }
      }

      if (!failure && validated.folderPath !== undefined) {
        const outcome = await performMoveTableToFolder({
          table,
          folderId: resolution?.folderId ?? null,
          userId,
          requestId,
          request,
        })
        if (outcome.success) {
          applied.push('folderPath')
        } else {
          failure = {
            outcome:
              outcome.errorCode === 'not_found'
                ? { ...outcome, error: 'Table not found' }
                : outcome,
            fallback: 'Failed to move table',
          }
        }
      }

      if (applied.length > 0) signalTableSchemaChanged(tableId)
      if (failure) {
        return v2TableOrchestrationError(failure.outcome, failure.fallback, appliedDetails(applied))
      }

      const updated = await getTableById(tableId)
      if (!updated) {
        return v2Error('NOT_FOUND', 'Table not found', { details: appliedDetails(applied) })
      }

      const folderIndex = await loadActiveFolderPathIndex(table.workspaceId, 'table')
      return v2Data(
        { table: toApiTable(updated, folderPathForId(folderIndex, updated.folderId)) },
        { rateLimit }
      )
    } catch (error) {
      const details = appliedDetails(applied)

      const lockError = v2TableLockError(error, details)
      if (lockError) return lockError

      const classified = asOrchestrationError(error)
      if (classified) {
        return v2TableOrchestrationError(
          { errorCode: classified.code, error: classified.message },
          'Failed to update table',
          details
        )
      }

      logger.error(`[${requestId}] Error updating table`, {
        error: getErrorMessage(error, 'Unknown error'),
        applied,
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error', { details })
    }
  },
})

export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteTableContract,
  rateLimitEndpoint: 'table-detail',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const { workspaceId } = input.query

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const result = await checkAccess(tableId, userId, 'write')
      if (!result.ok) return v2TableAccessError(result)

      if (result.table.workspaceId !== workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const outcome = await performDeleteTable({ table: result.table, userId, requestId, request })
      if (!outcome.success) {
        return v2TableOrchestrationError(outcome, 'Failed to delete table')
      }

      return v2Data({ id: tableId, deleted: true }, { rateLimit })
    } catch (error) {
      const lockError = v2TableLockError(error)
      if (lockError) return lockError
      throw error
    }
  },
})
