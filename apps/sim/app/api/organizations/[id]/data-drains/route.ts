import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { dataDrains } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createDataDrainContract, listDataDrainsContract } from '@/lib/api/contracts/data-drains'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeDrainAccess } from '@/lib/data-drains/access'
import { getDestination } from '@/lib/data-drains/destinations/registry'
import { encryptCredentials } from '@/lib/data-drains/encryption'
import { serializeDrain } from '@/lib/data-drains/serializers'

const logger = createLogger('DataDrainsAPI')

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { id: organizationId } = await context.params
  const access = await authorizeDrainAccess(organizationId, { requireMutating: false })
  if (!access.ok) return access.response

  const parsed = await parseRequest(listDataDrainsContract, request, context)
  if (!parsed.success) return parsed.response

  const rows = await db
    .select()
    .from(dataDrains)
    .where(eq(dataDrains.organizationId, organizationId))
    .orderBy(asc(dataDrains.createdAt))

  return NextResponse.json({ drains: rows.map(serializeDrain) })
})

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { id: organizationId } = await context.params
  const access = await authorizeDrainAccess(organizationId, { requireMutating: true })
  if (!access.ok) return access.response

  const parsed = await parseRequest(createDataDrainContract, request, context)
  if (!parsed.success) return parsed.response

  const body = parsed.data.body

  if (!body.destinationCredentials) {
    return NextResponse.json(
      { error: 'destinationCredentials is required when creating a drain' },
      { status: 400 }
    )
  }
  const destination = getDestination(body.destinationType)
  const configResult = destination.configSchema.safeParse(body.destinationConfig)
  if (!configResult.success) return validationErrorResponse(configResult.error)
  const credentialsResult = destination.credentialsSchema.safeParse(body.destinationCredentials)
  if (!credentialsResult.success) return validationErrorResponse(credentialsResult.error)
  const encryptedCredentials = await encryptCredentials(credentialsResult.data)

  const [existing] = await db
    .select({ id: dataDrains.id })
    .from(dataDrains)
    .where(and(eq(dataDrains.organizationId, organizationId), eq(dataDrains.name, body.name)))
    .limit(1)
  if (existing) {
    return NextResponse.json(
      { error: 'A data drain with this name already exists in this organization' },
      { status: 409 }
    )
  }

  const id = generateId()
  const now = new Date()
  const [inserted] = await db
    .insert(dataDrains)
    .values({
      id,
      organizationId,
      name: body.name,
      source: body.source,
      destinationType: body.destinationType,
      destinationConfig: configResult.data as Record<string, unknown>,
      destinationCredentials: encryptedCredentials,
      scheduleCadence: body.scheduleCadence,
      enabled: body.enabled ?? true,
      cursor: null,
      createdBy: access.session.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  logger.info('Data drain created', {
    drainId: id,
    organizationId,
    source: body.source,
    destinationType: body.destinationType,
  })

  recordAudit({
    workspaceId: null,
    actorId: access.session.user.id,
    action: AuditAction.DATA_DRAIN_CREATED,
    resourceType: AuditResourceType.DATA_DRAIN,
    resourceId: id,
    actorName: access.session.user.name ?? undefined,
    actorEmail: access.session.user.email ?? undefined,
    resourceName: body.name,
    description: `Created data drain '${body.name}'`,
    metadata: {
      organizationId,
      source: body.source,
      destinationType: body.destinationType,
      scheduleCadence: body.scheduleCadence,
    },
    request,
  })

  return NextResponse.json({ drain: serializeDrain(inserted) }, { status: 201 })
})
