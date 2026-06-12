import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { dataDrainRuns } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { runDataDrainContract } from '@/lib/api/contracts/data-drains'
import { parseRequest } from '@/lib/api/server'
import { getJobQueue } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeDrainAccess, loadDrain } from '@/lib/data-drains/access'

const logger = createLogger('DataDrainRunAPI')

type RouteContext = { params: Promise<{ id: string; drainId: string }> }

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { id: organizationId, drainId } = await context.params
  const access = await authorizeDrainAccess(organizationId, { requireMutating: true })
  if (!access.ok) return access.response

  const parsed = await parseRequest(runDataDrainContract, request, context)
  if (!parsed.success) return parsed.response

  const drain = await loadDrain(organizationId, drainId)
  if (!drain) {
    return NextResponse.json({ error: 'Data drain not found' }, { status: 404 })
  }
  if (!drain.enabled) {
    return NextResponse.json(
      { error: 'Cannot run a disabled drain. Enable it first.' },
      { status: 400 }
    )
  }

  // Reject obvious double-fires up-front. The job-queue concurrencyKey is the
  // real serialization barrier (it covers the gap between enqueue and the
  // runner inserting the `running` row), but this gives the user immediate
  // feedback when a run is already in flight.
  const [inFlight] = await db
    .select({ id: dataDrainRuns.id })
    .from(dataDrainRuns)
    .where(and(eq(dataDrainRuns.drainId, drainId), eq(dataDrainRuns.status, 'running')))
    .limit(1)
  if (inFlight) {
    return NextResponse.json(
      { error: 'A run is already in progress for this drain' },
      { status: 409 }
    )
  }

  const queue = await getJobQueue()
  const jobId = await queue.enqueue(
    'run-data-drain',
    { drainId, trigger: 'manual' },
    { concurrencyKey: `data-drain:${drainId}` }
  )

  logger.info('Manually enqueued data drain run', { drainId, organizationId, jobId })

  recordAudit({
    workspaceId: null,
    actorId: access.session.user.id,
    action: AuditAction.DATA_DRAIN_RAN,
    resourceType: AuditResourceType.DATA_DRAIN,
    resourceId: drainId,
    actorName: access.session.user.name ?? undefined,
    actorEmail: access.session.user.email ?? undefined,
    resourceName: drain.name,
    description: `Triggered manual run for data drain '${drain.name}'`,
    metadata: { organizationId, jobId, trigger: 'manual' },
    request,
  })

  return NextResponse.json({ jobId })
})
