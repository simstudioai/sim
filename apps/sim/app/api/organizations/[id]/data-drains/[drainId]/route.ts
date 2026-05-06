import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { dataDrains } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, ne } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteDataDrainContract,
  getDataDrainContract,
  updateDataDrainContract,
} from '@/lib/api/contracts/data-drains'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeDrainAccess, loadDrain } from '@/lib/data-drains/access'
import { getDestination } from '@/lib/data-drains/destinations/registry'
import { encryptCredentials } from '@/lib/data-drains/encryption'
import { serializeDrain } from '@/lib/data-drains/serializers'

const logger = createLogger('DataDrainAPI')

type RouteContext = { params: Promise<{ id: string; drainId: string }> }

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { id: organizationId, drainId } = await context.params
  const access = await authorizeDrainAccess(organizationId, { requireMutating: false })
  if (!access.ok) return access.response

  const parsed = await parseRequest(getDataDrainContract, request, context)
  if (!parsed.success) return parsed.response

  const drain = await loadDrain(organizationId, drainId)
  if (!drain) {
    return NextResponse.json({ error: 'Data drain not found' }, { status: 404 })
  }
  return NextResponse.json({ drain: serializeDrain(drain) })
})

export const PUT = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { id: organizationId, drainId } = await context.params
  const access = await authorizeDrainAccess(organizationId, { requireMutating: true })
  if (!access.ok) return access.response

  const parsed = await parseRequest(updateDataDrainContract, request, context)
  if (!parsed.success) return parsed.response

  const body = parsed.data.body

  const drain = await loadDrain(organizationId, drainId)
  if (!drain) {
    return NextResponse.json({ error: 'Data drain not found' }, { status: 404 })
  }

  if (body.name !== undefined && body.name !== drain.name) {
    const [conflict] = await db
      .select({ id: dataDrains.id })
      .from(dataDrains)
      .where(
        and(
          eq(dataDrains.organizationId, organizationId),
          eq(dataDrains.name, body.name),
          ne(dataDrains.id, drainId)
        )
      )
      .limit(1)
    if (conflict) {
      return NextResponse.json(
        { error: 'A data drain with this name already exists in this organization' },
        { status: 409 }
      )
    }
  }

  if (body.source !== undefined && body.source !== drain.source) {
    return NextResponse.json({ error: 'source cannot be changed after creation' }, { status: 400 })
  }

  const updates: Partial<typeof dataDrains.$inferInsert> = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.scheduleCadence !== undefined) updates.scheduleCadence = body.scheduleCadence
  if (body.enabled !== undefined) updates.enabled = body.enabled

  if (body.destinationType !== undefined && body.destinationType !== drain.destinationType) {
    return NextResponse.json(
      { error: 'destinationType cannot be changed after creation' },
      { status: 400 }
    )
  }
  if (body.destinationConfig !== undefined || body.destinationCredentials !== undefined) {
    const destination = getDestination(drain.destinationType)
    if (body.destinationConfig !== undefined) {
      const configResult = destination.configSchema.safeParse(body.destinationConfig)
      if (!configResult.success) return validationErrorResponse(configResult.error)
      updates.destinationConfig = configResult.data as Record<string, unknown>
    }
    if (body.destinationCredentials !== undefined) {
      const credentialsResult = destination.credentialsSchema.safeParse(body.destinationCredentials)
      if (!credentialsResult.success) return validationErrorResponse(credentialsResult.error)
      updates.destinationCredentials = await encryptCredentials(credentialsResult.data)
    }
  }

  const [updated] = await db
    .update(dataDrains)
    .set(updates)
    .where(eq(dataDrains.id, drainId))
    .returning()

  if (!updated) {
    // Concurrent DELETE landed between loadDrain() and this UPDATE.
    return NextResponse.json({ error: 'Data drain not found' }, { status: 404 })
  }

  logger.info('Data drain updated', { drainId, organizationId })

  recordAudit({
    workspaceId: null,
    actorId: access.session.user.id,
    action: AuditAction.DATA_DRAIN_UPDATED,
    resourceType: AuditResourceType.DATA_DRAIN,
    resourceId: drainId,
    actorName: access.session.user.name ?? undefined,
    actorEmail: access.session.user.email ?? undefined,
    resourceName: updated.name,
    description: `Updated data drain '${updated.name}'`,
    metadata: {
      organizationId,
      changes: {
        name: body.name,
        source: body.source,
        scheduleCadence: body.scheduleCadence,
        enabled: body.enabled,
        destinationConfigChanged: body.destinationConfig !== undefined,
        destinationCredentialsChanged: body.destinationCredentials !== undefined,
      },
    },
    request,
  })

  return NextResponse.json({ drain: serializeDrain(updated) })
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { id: organizationId, drainId } = await context.params
  const access = await authorizeDrainAccess(organizationId, { requireMutating: true })
  if (!access.ok) return access.response

  const parsed = await parseRequest(deleteDataDrainContract, request, context)
  if (!parsed.success) return parsed.response

  const drain = await loadDrain(organizationId, drainId)
  if (!drain) {
    return NextResponse.json({ error: 'Data drain not found' }, { status: 404 })
  }

  await db.delete(dataDrains).where(eq(dataDrains.id, drainId))

  logger.info('Data drain deleted', { drainId, organizationId })

  recordAudit({
    workspaceId: null,
    actorId: access.session.user.id,
    action: AuditAction.DATA_DRAIN_DELETED,
    resourceType: AuditResourceType.DATA_DRAIN,
    resourceId: drainId,
    actorName: access.session.user.name ?? undefined,
    actorEmail: access.session.user.email ?? undefined,
    resourceName: drain.name,
    description: `Deleted data drain '${drain.name}'`,
    metadata: {
      organizationId,
      source: drain.source,
      destinationType: drain.destinationType,
    },
    request,
  })

  return NextResponse.json({ success: true as const })
})
