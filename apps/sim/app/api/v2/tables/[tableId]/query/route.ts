import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import { V2_DEFAULT_ROW_LIMIT, v2QueryRowsContract } from '@/lib/api/contracts/v2/tables'
import { isZodError, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Sort, TablePredicate, TableSchema } from '@/lib/table'
import { buildIdByName, sortSpecNamesToIds } from '@/lib/table'
import { namedRowMapper } from '@/lib/table/cell-format'
import { TableQueryValidationError } from '@/lib/table/errors'
import { validatePredicate, validateSortSpec } from '@/lib/table/query-builder/validate'
import { assertCursorSortBinding, decodeCursor } from '@/lib/table/rows/cursor'
import { queryRows } from '@/lib/table/rows/service'
import { predicateToStorage } from '@/lib/table/select-values'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toApiRow, v2TablesGateError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableQueryAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface QueryRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/v2/tables/[tableId]/query — public row query. Typed `predicate`/`sort`
 * objects + opaque cursor pagination. Default page {@link V2_DEFAULT_ROW_LIMIT};
 * `limit=0` = unbounded (whole result or 400).
 */
export const POST = withRouteHandler(async (request: NextRequest, context: QueryRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'table-rows')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v2QueryRowsContract, request, context, {
      maxBodyBytes: TABLE_QUERY_MAX_BODY_BYTES,
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, sort, cursor: cursorToken, limit } = parsed.data.body

    const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const accessResult = await checkAccess(tableId, userId, 'read')
    // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
    if (!accessResult.ok) return v2Error('NOT_FOUND', 'Table not found')

    const { table } = accessResult
    if (workspaceId !== table.workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const gateError = await v2TablesGateError(userId, workspaceId)
    if (gateError) return gateError

    const schema = table.schema as TableSchema
    const cursor = cursorToken ? decodeCursor(cursorToken) : undefined

    const idByName = buildIdByName(schema)
    // Fuses the id→name key remap with select-cell value formatting, so a select
    // cell surfaces its option NAME rather than the stored option id.
    const toNamedRow = namedRowMapper(schema.columns)
    let predicate: TablePredicate | undefined = parsed.data.body.predicate
    if (predicate) {
      validatePredicate(predicate, schema.columns)
      predicate = predicateToStorage(predicate, schema)
    }
    let sortSpec = sort
    if (sortSpec?.length) {
      validateSortSpec(sortSpec, schema.columns)
      sortSpec = sortSpecNamesToIds(sortSpec, idByName)
    }
    const sortObj: Sort | undefined = sortSpec?.length
      ? Object.fromEntries(sortSpec.map((s) => [s.field, s.direction]))
      : undefined

    // A cursor is only valid for the query shape it was minted under: keyset
    // cursors bind to the default order, offset cursors to their sort. Runs on
    // the STORAGE-keyed sort so the fingerprint matches what queryRows stamped.
    if (cursor) assertCursorSortBinding(cursor, sortObj)

    // Public default is a bounded page (unlike the internal surface's unbounded
    // omit). `limit=0` is the explicit unbounded opt-in.
    const effectiveLimit =
      limit === undefined ? V2_DEFAULT_ROW_LIMIT : limit === 0 ? undefined : limit

    const result = await queryRows(
      table,
      {
        predicate,
        sort: sortObj,
        limit: effectiveLimit,
        after: cursor?.after,
        offset: cursor?.offset,
        includeTotal: false,
        withExecutions: false,
      },
      requestId
    )

    return v2CursorList(
      result.rows.map((r) => toApiRow(r, toNamedRow)),
      result.nextCursor,
      { rateLimit }
    )
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)

    if (error instanceof TableQueryValidationError) {
      return v2Error('BAD_REQUEST', error.message, {
        details: error.code ? { code: error.code } : undefined,
      })
    }

    logger.error(`[${requestId}] Error querying rows (v2 public)`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
