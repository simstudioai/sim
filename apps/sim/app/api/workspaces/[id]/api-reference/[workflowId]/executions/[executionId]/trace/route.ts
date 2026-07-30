import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getApiReferenceTraceContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'
import { resolveReadablePublication } from '@/lib/workflows/api-reference'

const logger = createLogger('ApiReferenceTraceAPI')

/**
 * The block-level execution trace for one run of a published workflow, reusing the
 * existing execution-log representation verbatim (`materializeExecutionData`).
 *
 * Available only when the provider set `exposeTrace='traceId'`. Scoping is
 * capability-based: the `executionId` is an unguessable UUID handed back only to
 * whoever invoked the run, and it is additionally bound to this published workflow +
 * workspace. This prevents enumeration and cross-caller reads without a stored actor
 * column; production should record explicit caller attribution (see POC.md). Every
 * denial is a 404.
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: {
      params: Promise<{ id: string; workflowId: string; executionId: string }>
    }
  ) => {
    if (!(await isFeatureEnabled('api-reference-doc'))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getApiReferenceTraceContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, workflowId, executionId } = parsed.data.params

    const readable = await resolveReadablePublication(workflowId, session.user.id)
    if (
      !readable ||
      readable.workspaceId !== workspaceId ||
      readable.publication.exposeTrace !== 'traceId'
    ) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const [log] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    // The execution must belong to exactly this published workflow + workspace;
    // otherwise possession of the id grants nothing.
    if (!log || log.workflowId !== workflowId || log.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const trace = await materializeExecutionData(
      log.executionData as Record<string, unknown> | null,
      { workspaceId, workflowId, executionId }
    )

    logger.info('Served execution trace', { workspaceId, workflowId, executionId })
    return NextResponse.json({
      executionId,
      workflowId,
      status: log.status ?? null,
      startedAt: log.startedAt ? log.startedAt.toISOString() : null,
      endedAt: log.endedAt ? log.endedAt.toISOString() : null,
      totalDurationMs: log.totalDurationMs ?? null,
      trace,
    })
  }
)
