import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import {
  getPublicInterfaceTableRowsContract,
  PUBLIC_TABLE_MAX_ROWS,
} from '@/lib/api/contracts/public-interfaces'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolvePublicInterfaceModule } from '@/lib/public-shares/interface-access'
import { enforcePerIpRateLimit, enforcePerShareRateLimit } from '@/lib/public-shares/rate-limit'
import { queryRows } from '@/lib/table/rows/service'
import { getTableById } from '@/lib/table/service'
import type { TableRow } from '@/lib/table/types'
import {
  publicInterfaceJson,
  publicInterfaceNotFound,
} from '@/app/api/interfaces/public/[token]/modules/[moduleId]/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicInterfaceTableRowsAPI')

/**
 * Public row projection. `executions` is pinned to `{}` alongside the
 * `withExecutions: false` read: per-row workflow run state (run ids, statuses,
 * costs) is internal workspace state and must never reach a public viewer, and
 * pinning it here keeps that guarantee visible at the serialization site rather
 * than only in the query options.
 */
function toWireRow(row: TableRow): TableRow {
  return {
    id: row.id,
    data: row.data,
    executions: {},
    position: row.position,
    orderKey: row.orderKey ?? undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
}

/**
 * GET /api/interfaces/public/[token]/modules/[moduleId]/table/rows
 *
 * Rows of the table a shared interface's table module points at. The table id is
 * **derived** from the interface's stored layout — the route accepts no table
 * identifier of any kind — and is then re-asserted to live in the interface's
 * own workspace before a single row is read.
 *
 * Pagination is offset-based rather than keyset: the public drain is capped at
 * {@link PUBLIC_TABLE_MAX_ROWS}, so the deepest reachable page is shallow enough
 * that OFFSET's scan cost is irrelevant, and an integer offset keeps the whole
 * public query surface URL-safe scalars.
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ token: string; moduleId: string }> }
  ) => {
    const requestId = generateRequestId()

    const limited = await enforcePerIpRateLimit(request, 'content')
    if (limited) return limited

    const parsed = await parseRequest(getPublicInterfaceTableRowsContract, request, context)
    if (!parsed.success) return parsed.response
    const { token, moduleId } = parsed.data.params
    const { limit, offset, includeTotal } = parsed.data.query

    const result = await resolvePublicInterfaceModule({
      token,
      moduleId,
      expectedType: 'table',
      request,
      requestId,
    })
    if (!result.ok) return result.response
    const { share, workspaceId, resource } = result.access

    /**
     * The share is only known after the token resolves, so the aggregate
     * per-share ceiling is enforced here rather than alongside the per-IP bucket
     * above. Both apply: the per-IP bucket bounds one visitor, this one bounds a
     * link that has been passed around.
     */
    const shareLimited = await enforcePerShareRateLimit('content', share.id)
    if (shareLimited) return shareLimited

    /**
     * Re-assert same-workspace on the resolved resource. `validateLayout`
     * grandfathers references that were already stored, so a stored reference is
     * only proven in-workspace at the moment it was introduced — this check
     * closes that window on every read. `getTableById` excludes archived tables
     * by default, which covers the "table archived after sharing" case.
     */
    const table = await getTableById(resource.id)
    if (!table || table.workspaceId !== workspaceId) {
      logger.warn(`[${requestId}] Public interface table reference no longer resolves`, {
        moduleId,
      })
      return publicInterfaceNotFound()
    }

    const remaining = PUBLIC_TABLE_MAX_ROWS - offset
    if (remaining <= 0) {
      return publicInterfaceJson({
        rows: [],
        rowCount: 0,
        totalCount: null,
        limit,
        offset,
        hasMore: false,
      })
    }

    const page = await queryRows(
      table,
      { limit: Math.min(limit, remaining), offset, includeTotal, withExecutions: false },
      requestId
    )

    /**
     * Terminal only when the page came back empty, when the public ceiling is
     * reached, or when page 0's `COUNT(*)` is already covered — never because a
     * page was merely shorter than requested, which a concurrent delete can
     * cause without the table being exhausted.
     */
    const loaded = offset + page.rows.length
    const hasMore =
      page.rows.length > 0 &&
      loaded < PUBLIC_TABLE_MAX_ROWS &&
      (page.totalCount === null || loaded < page.totalCount)

    return publicInterfaceJson({
      rows: page.rows.map(toWireRow),
      rowCount: page.rowCount,
      totalCount: page.totalCount,
      limit: page.limit,
      offset: page.offset,
      hasMore,
    })
  }
)
