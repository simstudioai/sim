import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { testDataDrainContract } from '@/lib/api/contracts/data-drains'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeDrainAccess, loadDrain } from '@/lib/data-drains/access'
import { getDestination } from '@/lib/data-drains/destinations/registry'
import { decryptCredentials } from '@/lib/data-drains/encryption'

const logger = createLogger('DataDrainTestAPI')

const TEST_TIMEOUT_MS = 10_000

type RouteContext = { params: Promise<{ id: string; drainId: string }> }

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { id: organizationId, drainId } = await context.params
  const access = await authorizeDrainAccess(organizationId, { requireMutating: true })
  if (!access.ok) return access.response

  const parsed = await parseRequest(testDataDrainContract, request, context)
  if (!parsed.success) return parsed.response

  const drain = await loadDrain(organizationId, drainId)
  if (!drain) {
    return NextResponse.json({ error: 'Data drain not found' }, { status: 404 })
  }

  const destination = getDestination(drain.destinationType)
  if (!destination.test) {
    return NextResponse.json(
      { error: `Destination '${drain.destinationType}' does not support connection testing` },
      { status: 400 }
    )
  }

  const config = destination.configSchema.parse(drain.destinationConfig)
  const credentials = destination.credentialsSchema.parse(
    await decryptCredentials(drain.destinationCredentials)
  )

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  try {
    await destination.test({ config, credentials, signal: controller.signal })
    recordAudit({
      workspaceId: null,
      actorId: access.session.user.id,
      action: AuditAction.DATA_DRAIN_TESTED,
      resourceType: AuditResourceType.DATA_DRAIN,
      resourceId: drainId,
      actorName: access.session.user.name ?? undefined,
      actorEmail: access.session.user.email ?? undefined,
      resourceName: drain.name,
      description: `Tested connection for data drain '${drain.name}' (success)`,
      metadata: { organizationId, destinationType: drain.destinationType, outcome: 'success' },
      request,
    })
    return NextResponse.json({ ok: true as const })
  } catch (error) {
    const message = toError(error).message
    logger.warn('Data drain test connection failed', {
      drainId,
      destinationType: drain.destinationType,
      error: message,
    })
    recordAudit({
      workspaceId: null,
      actorId: access.session.user.id,
      action: AuditAction.DATA_DRAIN_TESTED,
      resourceType: AuditResourceType.DATA_DRAIN,
      resourceId: drainId,
      actorName: access.session.user.name ?? undefined,
      actorEmail: access.session.user.email ?? undefined,
      resourceName: drain.name,
      description: `Tested connection for data drain '${drain.name}' (failed)`,
      metadata: {
        organizationId,
        destinationType: drain.destinationType,
        outcome: 'failed',
        error: message,
      },
      request,
    })
    return NextResponse.json({ error: message }, { status: 400 })
  } finally {
    clearTimeout(timeout)
  }
})
