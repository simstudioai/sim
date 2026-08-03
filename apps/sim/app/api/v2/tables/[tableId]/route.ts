import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2DeleteTableContract,
  v2GetTableContract,
  v2UpdateTableContract,
} from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { findActiveFolder } from '@/lib/folders/queries'
import { getTableById } from '@/lib/table'
import { signalTableSchemaChanged } from '@/lib/table/events'
import {
  performDeleteTable,
  performMoveTableToFolder,
  performRenameTable,
} from '@/lib/table/orchestration'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
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
  applied: readonly ('name' | 'folderId')[]
): { applied: readonly string[] } | undefined {
  return applied.length > 0 ? { applied } : undefined
}

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
export const PATCH = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()

  /**
   * Hoisted above the `try` so every exit path can report it. Once a write has
   * committed, the response must say so even when the failure came *after* the
   * writes — a throw in the final re-read, or the re-read finding the table
   * archived. Reporting a bare 500 there tells the caller nothing landed, and
   * it retries into a duplicate-name conflict or a repeated move.
   */
  const applied: ('name' | 'folderId')[] = []

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
    // The two operations are separate transactions, so a rejection discovered
    // partway through would leave the earlier one persisted while the response
    // reports failure. Everything a request can be rejected for is therefore
    // checked up front: a rejected PATCH changes nothing.
    if (validated.folderId != null) {
      // Scoped to `resourceType: 'table'` so a folder id from another resource's
      // tree can't file the table somewhere Tables never lists.
      if (!(await findActiveFolder(validated.folderId, table.workspaceId, 'table'))) {
        return v2Error('NOT_FOUND', 'Folder not found in this workspace')
      }
    }

    // ── Apply ──
    // Every deterministic rejection is already behind us, so a failure here is
    // a genuine fault (lost race, archived mid-request, database error) rather
    // than a bad request. The two operations commit independently — a single
    // transaction would have to span two shared service functions that also
    // back the first-party route and two copilot tools, and would break their
    // per-operation audits — so instead of pretending atomicity the response
    // states exactly which operations landed. A caller that gets an error can
    // then reconcile rather than having to re-read and diff.
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

    if (!failure && validated.folderId !== undefined) {
      const outcome = await performMoveTableToFolder({
        table,
        folderId: validated.folderId,
        userId,
        requestId,
        request,
      })
      if (outcome.success) {
        applied.push('folderId')
      } else {
        // The move re-asserts workspace and active state, so a miss means the
        // table was archived between `checkAccess` and the write.
        failure = {
          outcome:
            outcome.errorCode === 'not_found' ? { ...outcome, error: 'Table not found' } : outcome,
          fallback: 'Failed to move table',
        }
      }
    }

    // Live-collab: tell open viewers the definition changed so they refetch.
    if (applied.length > 0) signalTableSchemaChanged(tableId)
    if (failure) {
      return v2TableOrchestrationError(failure.outcome, failure.fallback, appliedDetails(applied))
    }

    // Re-read so the response reflects every applied change at once. A miss
    // means the table was archived after the writes committed, so the caller
    // still has to be told what landed.
    const updated = await getTableById(tableId)
    if (!updated) {
      return v2Error('NOT_FOUND', 'Table not found', { details: appliedDetails(applied) })
    }

    return v2Data({ table: toApiTable(updated) }, { rateLimit })
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
