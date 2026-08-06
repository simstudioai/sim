import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import {
  type V2WorkflowVersion,
  v2ListWorkflowVersionsContract,
} from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkflowVersions } from '@/lib/workflows/persistence/utils'
import { checkRateLimit } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'
import { resolveV2WorkflowTarget } from '@/app/api/v2/workflows/utils'

const logger = createLogger('V2WorkflowVersionsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Keyset cursor over the dense, strictly-descending version number. */
interface WorkflowVersionCursor {
  version: number
}

/**
 * GET /api/v2/workflows/[id]/versions — List a workflow's deployment versions,
 * newest first. These are the versions `POST /api/v2/workflows/[id]/rollback`
 * accepts, so a caller no longer has to guess a version number.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-versions')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2ListWorkflowVersionsContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const { limit, cursor } = parsed.data.query

      const target = await resolveV2WorkflowTarget(rateLimit, userId, id)
      if (!target) return v2Error('NOT_FOUND', 'Workflow not found')

      /**
       * A cursor that decodes to anything other than a version number is
       * rejected rather than ignored: comparing every row against a missing
       * `version` yields an empty page with `nextCursor: null`, which reads to
       * the caller as a clean end-of-list while versions are still pending.
       */
      const after = cursor ? decodeCursor<WorkflowVersionCursor>(cursor) : null
      if (cursor && (!after || !Number.isInteger(after.version) || after.version < 1)) {
        return v2Error('BAD_REQUEST', 'Invalid cursor')
      }

      // One extra row is the has-more probe, matching the other v2 cursor lists.
      const { versions: rows } = await listWorkflowVersions(id, {
        limit: limit + 1,
        afterVersion: after?.version,
      })

      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)

      const data: V2WorkflowVersion[] = page.map((row) => ({
        id: row.id,
        version: row.version,
        name: row.name,
        description: row.description,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
        deployedBy: row.deployedByName,
        // The shared helper widens the operation-status pg enum to `string`.
        latestOperationStatus:
          row.latestOperationStatus as V2WorkflowVersion['latestOperationStatus'],
      }))

      const nextCursor =
        hasMore && data.length > 0 ? encodeCursor({ version: data[data.length - 1].version }) : null

      return v2CursorList(data, nextCursor, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Workflow versions fetch error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
