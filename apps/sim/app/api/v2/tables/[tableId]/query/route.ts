import { TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import { V2_DEFAULT_ROW_LIMIT, v2QueryRowsContract } from '@/lib/api/contracts/v2/tables'
import { isZodError } from '@/lib/api/server'
import type { Sort, TablePredicate, TableSchema } from '@/lib/table'
import { buildIdByName, sortSpecNamesToIds } from '@/lib/table'
import { namedRowMapper } from '@/lib/table/cell-format'
import { TableQueryValidationError } from '@/lib/table/errors'
import { validatePredicate, validateSortSpec } from '@/lib/table/query-builder/validate'
import { assertCursorSortBinding, decodeCursor } from '@/lib/table/rows/cursor'
import { queryRows } from '@/lib/table/rows/service'
import { predicateToStorage } from '@/lib/table/select-values'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { checkAccess } from '@/app/api/table/utils'
import { resolveWorkspaceScope } from '@/app/api/v1/middleware'
import {
  v2CursorList,
  v2Error,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toApiRow } from '@/app/api/v2/tables/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/tables/[tableId]/query — public row query. Typed `predicate`/`sort`
 * objects + opaque cursor pagination. Default page {@link V2_DEFAULT_ROW_LIMIT};
 * `limit=0` = unbounded (whole result or 400).
 */
export const POST = withPublicApiRouteHandler({
  contract: v2QueryRowsContract,
  rateLimitEndpoint: 'table-rows',
  parseOptions: {
    maxBodyBytes: TABLE_QUERY_MAX_BODY_BYTES,
  },
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { tableId } = input.params
      const { workspaceId, sort, cursor: cursorToken, limit } = input.body

      const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
      if (scopeError) return v2WorkspaceAccessError(scopeError)

      const accessResult = await checkAccess(tableId, userId, 'read')
      // Mask not-authorized and not-found alike so cross-workspace existence never leaks.
      if (!accessResult.ok) return v2Error('NOT_FOUND', 'Table not found')

      const { table } = accessResult
      if (workspaceId !== table.workspaceId) {
        return v2Error('NOT_FOUND', 'Table not found')
      }

      const schema = table.schema as TableSchema
      const cursor = cursorToken ? decodeCursor(cursorToken) : undefined

      const idByName = buildIdByName(schema)
      // Fuses the id→name key remap with select-cell value formatting, so a select
      // cell surfaces its option NAME rather than the stored option id.
      const toNamedRow = namedRowMapper(schema.columns)
      let predicate: TablePredicate | undefined = input.body.predicate
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

      throw error
    }
  },
})
