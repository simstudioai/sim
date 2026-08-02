import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest, NextResponse } from 'next/server'
import {
  v2DeleteTableContract,
  v2GetTableContract,
  v2UpdateTableContract,
} from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { findActiveFolder } from '@/lib/folders/queries'
import { getTableById } from '@/lib/table'
import { signalTableSchemaChanged } from '@/lib/table/events'
import {
  performDeleteTable,
  performMoveTableToFolder,
  performRenameTable,
  performUpdateTableLocks,
} from '@/lib/table/orchestration'
import { TABLE_LOCK_FLAGS, TABLE_LOCK_KINDS } from '@/lib/table/types'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import {
  toApiTable,
  v2TableAccessError,
  v2TableLockError,
  v2TableOrchestrationError,
} from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/** GET /api/v2/tables/[tableId] — Get table details. */
export const GET = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetTableContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!result.ok) return v2Error('NOT_FOUND', 'Table not found')

    if (result.table.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    return v2Data({ table: toApiTable(result.table) }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error getting table`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/**
 * PATCH /api/v2/tables/[tableId] — Rename, move, and/or change lock flags.
 *
 * Each field routes to its own orchestration call so the audit records the
 * operation the caller actually performed. `locks` carries the first-party
 * permission split: `write` is the floor for the endpoint, but enabling a lock
 * additionally needs workspace `admin` and the `table-locks` feature. Clearing
 * a lock stays available with the feature off, or flipping the kill switch
 * would strand an already-locked table with no way to unlock it while
 * enforcement of the stored locks keeps running.
 */
export const PATCH = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateTableContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const validated = parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, validated.workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const result = await checkAccess(tableId, userId, 'write')
    if (!result.ok) return v2TableAccessError(result)

    const { table } = result
    if (table.workspaceId !== validated.workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    // ── Validate every field BEFORE the first write ──
    // The three operations are separate transactions, so a rejection
    // discovered partway through would leave the earlier ones persisted while
    // the response reports failure. Everything a request can be rejected for
    // is therefore checked up front: a rejected PATCH changes nothing.
    if (validated.locks !== undefined) {
      // Only a lock transitioning off→on needs the feature; comparing against
      // the stored state is what lets a caller submitting the full flag set
      // clear one lock while another stays on.
      const enablesALock = TABLE_LOCK_KINDS.some((kind) => {
        const flag = TABLE_LOCK_FLAGS[kind]
        return validated.locks?.[flag] === true && !table.locks[flag]
      })
      if (enablesALock) {
        // Resolved against the workspace's host organization, not the caller's
        // active one, so an org-targeted rollout can't accept the write here
        // and reject it in the first-party UI.
        const workspace = await getWorkspaceWithOwner(table.workspaceId)
        const enabled = await isFeatureEnabled('table-locks', {
          userId,
          orgId: workspace?.organizationId ?? undefined,
        })
        if (!enabled) return v2Error('FORBIDDEN', 'Table locks are not enabled')
      }

      const adminResult = await checkAccess(tableId, userId, 'admin')
      if (!adminResult.ok) {
        return v2Error('FORBIDDEN', 'Admin access required to change table locks')
      }
    }

    if (validated.folderId != null) {
      // Scoped to `resourceType: 'table'` so a folder id from another resource's
      // tree can't file the table somewhere Tables never lists.
      if (!(await findActiveFolder(validated.folderId, table.workspaceId, 'table'))) {
        return v2Error('NOT_FOUND', 'Folder not found in this workspace')
      }
    }

    // ── Apply ──
    // `applied` tracks whether anything reached the database, so a failure
    // partway through still signals open clients. Skipping the signal there
    // would leave every viewer rendering state that has already changed.
    let applied = false
    let failure: NextResponse | null = null

    if (validated.locks !== undefined) {
      const outcome = await performUpdateTableLocks({
        tableId,
        partial: validated.locks,
        userId,
        requestId,
        request,
      })
      if (outcome.success) {
        applied = true
      } else {
        failure = v2TableOrchestrationError(outcome, 'Failed to update table locks')
      }
    }

    if (!failure && validated.name !== undefined) {
      const outcome = await performRenameTable({
        table,
        newName: validated.name,
        userId,
        requestId,
        request,
      })
      if (outcome.success) {
        applied = true
      } else {
        failure = v2TableOrchestrationError(outcome, 'Failed to rename table')
      }
    }

    if (!failure && validated.folderId !== undefined) {
      const outcome = await performMoveTableToFolder({
        table,
        folderId: validated.folderId,
        userId,
        requestId,
        request,
      })
      if (outcome.success) {
        applied = true
      } else {
        // The move re-asserts workspace and active state, so a miss means the
        // table was archived between `checkAccess` and the write.
        failure = v2TableOrchestrationError(
          outcome.errorCode === 'not_found' ? { ...outcome, error: 'Table not found' } : outcome,
          'Failed to move table'
        )
      }
    }

    // Live-collab: tell open viewers the definition changed so they refetch.
    if (applied) signalTableSchemaChanged(tableId)
    if (failure) return failure

    // Re-read so the response reflects every applied change at once.
    const updated = await getTableById(tableId)
    if (!updated) return v2Error('NOT_FOUND', 'Table not found')

    return v2Data({ table: toApiTable(updated) }, { rateLimit })
  } catch (error) {
    const lockError = v2TableLockError(error)
    if (lockError) return lockError

    const classified = v2CaughtOrchestrationError(error)
    if (classified) return classified

    logger.error(`[${requestId}] Error updating table`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/tables/[tableId] — Archive a table. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteTableContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId } = parsed.data.query

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

    return v2Data({ id: tableId }, { rateLimit })
  } catch (error) {
    const lockError = v2TableLockError(error)
    if (lockError) return lockError
    logger.error(`[${requestId}] Error deleting table`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
