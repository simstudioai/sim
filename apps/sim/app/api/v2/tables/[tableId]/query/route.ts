import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import { V2_DEFAULT_ROW_LIMIT, v2QueryRowsContract } from '@/lib/api/contracts/v2/tables'
import { parseRequest, validationErrorResponseFromError } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Sort, TablePredicate, TableSchema } from '@/lib/table'
import {
  buildIdByName,
  buildNameById,
  predicateNamesToIds,
  rowDataIdToName,
  sortSpecNamesToIds,
} from '@/lib/table'
import { TableQueryValidationError } from '@/lib/table/errors'
import { validatePredicate, validateSortSpec } from '@/lib/table/query-builder/validate'
import { decodeCursor } from '@/lib/table/rows/cursor'
import { queryRows } from '@/lib/table/rows/service'
import { accessError, checkAccess, tablesV2GateError } from '@/app/api/table/utils'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
} from '@/app/api/v1/middleware'

const logger = createLogger('V2TableQueryAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Filters may carry user data; keep query responses out of shared caches. */
const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' } as const

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
    const rateLimit = await checkRateLimit(request, 'v2-table-rows')
    if (!rateLimit.allowed) return createRateLimitResponse(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v2QueryRowsContract, request, context, {
      maxBodyBytes: TABLE_QUERY_MAX_BODY_BYTES,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params
    const { workspaceId, sort, cursor: cursorToken, limit } = parsed.data.body

    const scopeError = await checkWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return scopeError

    const accessResult = await checkAccess(tableId, userId, 'read')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)
    const { table } = accessResult

    if (workspaceId !== table.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    // After authz: the gate reads the workspace's org off the primary DB, and its
    // 404 would otherwise distinguish "not in the rollout cohort" from "no access".
    const gateError = await tablesV2GateError(userId, workspaceId)
    if (gateError) return gateError

    const schema = table.schema as TableSchema
    const cursor = cursorToken ? decodeCursor(cursorToken) : undefined

    // A keyset cursor is bound to the DEFAULT `(order_key, id)` order; combining
    // it with a custom sort would relabel page 1 of the sorted view as a next page.
    if (cursor?.after && sort?.length) {
      return NextResponse.json(
        {
          error: 'Cursor is not valid for a sorted query. Restart paging without the cursor.',
          code: 'CURSOR_SORT_CONFLICT',
        },
        { status: 400, headers: PRIVATE_NO_STORE }
      )
    }

    const idByName = buildIdByName(schema)
    const nameById = buildNameById(schema)
    let predicate: TablePredicate | undefined = parsed.data.body.predicate
    if (predicate) {
      validatePredicate(predicate, schema.columns)
      predicate = predicateNamesToIds(predicate, idByName)
    }
    let sortSpec = sort
    if (sortSpec?.length) {
      validateSortSpec(sortSpec, schema.columns)
      sortSpec = sortSpecNamesToIds(sortSpec, idByName)
    }
    const sortObj: Sort | undefined = sortSpec?.length
      ? Object.fromEntries(sortSpec.map((s) => [s.field, s.direction]))
      : undefined

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
        includeTotal: !cursorToken,
        withExecutions: false,
      },
      requestId
    )

    return NextResponse.json(
      {
        success: true,
        data: {
          rows: result.rows.map((r) => ({
            id: r.id,
            data: rowDataIdToName(r.data, nameById),
            createdAt:
              r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
            updatedAt:
              r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
          })),
          rowCount: result.rowCount,
          totalCount: result.totalCount,
          limit: result.limit,
          nextCursor: result.nextCursor,
        },
      },
      { headers: PRIVATE_NO_STORE }
    )
  } catch (error) {
    const validationResponse = validationErrorResponseFromError(error)
    if (validationResponse) return validationResponse

    if (error instanceof TableQueryValidationError) {
      return NextResponse.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        { status: 400, headers: PRIVATE_NO_STORE }
      )
    }

    logger.error(`[${requestId}] Error querying rows (v2 public):`, error)
    return NextResponse.json({ error: 'Failed to query rows' }, { status: 500 })
  }
})
