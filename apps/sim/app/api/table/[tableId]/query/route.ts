import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { rowQueryContract } from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { isZodError, validationErrorResponse } from '@/lib/api/server/validation'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { Sort, TableSchema } from '@/lib/table'
import { buildIdByName, predicateNamesToIds, sortSpecNamesToIds } from '@/lib/table/column-keys'
import { TableQueryValidationError } from '@/lib/table/errors'
import { validatePredicate, validateSortSpec } from '@/lib/table/query-builder/validate'
import { decodeCursor } from '@/lib/table/rows/cursor'
import { queryRows } from '@/lib/table/rows/service'
import { rowWireTranslators } from '@/app/api/table/row-wire'
import { accessError, checkAccess } from '@/app/api/table/utils'

const logger = createLogger('TableRowQueryAPI')

interface RowQueryRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/table/[tableId]/query — v2 row query. Typed `predicate`/`sort`
 * objects (validated server-side) + opaque cursor pagination (no offset on the
 * wire). Shares the same engine as the legacy GET /rows route via `queryRows`.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RowQueryRouteParams) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(rowQueryContract, request, context)
    if (!parsed.success) return parsed.response
    const { params, body } = parsed.data
    const { tableId } = params

    const accessResult = await checkAccess(tableId, authResult.userId, 'read')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)
    const { table } = accessResult

    if (body.workspaceId !== table.workspaceId) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${body.workspaceId}, Actual: ${table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    const schema = table.schema as TableSchema
    const wire = rowWireTranslators(authResult.authType, schema)
    const cursor = body.cursor ? decodeCursor(body.cursor) : undefined

    // A keyset cursor encodes a position on the DEFAULT `(order_key, id)`
    // order; combining it with a custom order would silently return page 1
    // of the sorted view relabeled as a next page.
    if (cursor?.after && body.sort?.length) {
      return NextResponse.json(
        {
          error: 'Cursor is not valid for a sorted query. Restart paging without the cursor.',
          code: 'CURSOR_SORT_CONFLICT',
        },
        { status: 400 }
      )
    }

    // Predicate/sort fields are column-NAME-keyed by construction (the caller
    // authors names), so validate against the schema then translate names →
    // storage ids unconditionally — unlike row data, this is not authType-dependent.
    const idByName = buildIdByName(schema)
    let predicate = body.predicate
    if (predicate) {
      validatePredicate(predicate, schema.columns)
      predicate = predicateNamesToIds(predicate, idByName)
    }
    let sortSpec = body.sort
    if (sortSpec?.length) {
      validateSortSpec(sortSpec, schema.columns)
      sortSpec = sortSpecNamesToIds(sortSpec, idByName)
    }
    const sort: Sort | undefined = sortSpec?.length
      ? Object.fromEntries(sortSpec.map((s) => [s.field, s.direction]))
      : undefined

    const result = await queryRows(
      table,
      {
        predicate,
        sort,
        limit: body.limit,
        after: cursor?.after,
        offset: cursor?.offset,
        // Only the first page (no inbound cursor) pays for the total count.
        includeTotal: !body.cursor,
        // Executions are grid UI state; the v2 surface returns row data only
        // and the byte budget deliberately measures just `data`.
        withExecutions: false,
      },
      requestId
    )

    return NextResponse.json({
      success: true,
      data: {
        rows: result.rows.map((r) => ({
          id: r.id,
          data: wire.dataOut(r.data),
          executions: r.executions,
          position: r.position,
          orderKey: r.orderKey ?? undefined,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
        })),
        rowCount: result.rowCount,
        totalCount: result.totalCount,
        limit: result.limit,
        nextCursor: result.nextCursor,
      },
    })
  } catch (error) {
    if (isZodError(error)) return validationErrorResponse(error)
    if (error instanceof TableQueryValidationError) {
      return NextResponse.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        { status: 400 }
      )
    }
    logger.error(`[${requestId}] Error querying rows (v2):`, error)
    return NextResponse.json({ error: 'Failed to query rows' }, { status: 500 })
  }
})
