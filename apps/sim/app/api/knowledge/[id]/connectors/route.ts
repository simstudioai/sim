import { db } from '@sim/db'
import { knowledgeBaseTagDefinitions, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { dispatchSync } from '@/lib/knowledge/connectors/sync-engine'
import { allocateTagSlots } from '@/lib/knowledge/constants'
import { createTagDefinition } from '@/lib/knowledge/tags/service'
import { getCredential } from '@/app/api/auth/oauth/utils'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'

const logger = createLogger('KnowledgeConnectorsAPI')

const CreateConnectorSchema = z.object({
  connectorType: z.string().min(1),
  credentialId: z.string().min(1),
  sourceConfig: z.record(z.unknown()),
  syncIntervalMinutes: z.number().int().min(0).default(1440),
})

/**
 * GET /api/knowledge/[id]/connectors - List connectors for a knowledge base
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, auth.userId)
    if (!accessCheck.hasAccess) {
      const status = 'notFound' in accessCheck && accessCheck.notFound ? 404 : 401
      return NextResponse.json({ error: status === 404 ? 'Not found' : 'Unauthorized' }, { status })
    }

    const connectors = await db
      .select()
      .from(knowledgeConnector)
      .where(
        and(
          eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .orderBy(desc(knowledgeConnector.createdAt))

    return NextResponse.json({ success: true, data: connectors })
  } catch (error) {
    logger.error(`[${requestId}] Error listing connectors`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/knowledge/[id]/connectors - Create a new connector
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const writeCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
    if (!writeCheck.hasAccess) {
      const status = 'notFound' in writeCheck && writeCheck.notFound ? 404 : 401
      return NextResponse.json({ error: status === 404 ? 'Not found' : 'Unauthorized' }, { status })
    }

    const body = await request.json()
    const parsed = CreateConnectorSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { connectorType, credentialId, sourceConfig, syncIntervalMinutes } = parsed.data

    const connectorConfig = CONNECTOR_REGISTRY[connectorType]
    if (!connectorConfig) {
      return NextResponse.json(
        { error: `Unknown connector type: ${connectorType}` },
        { status: 400 }
      )
    }

    const credential = await getCredential(requestId, credentialId, auth.userId)
    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 400 })
    }

    if (!credential.accessToken) {
      return NextResponse.json(
        { error: 'Credential has no access token. Please reconnect your account.' },
        { status: 400 }
      )
    }

    const validation = await connectorConfig.validateConfig(credential.accessToken, sourceConfig)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid source configuration' },
        { status: 400 }
      )
    }

    let finalSourceConfig: Record<string, unknown> = sourceConfig
    const tagSlotMapping: Record<string, string> = {}

    if (connectorConfig.tagDefinitions?.length) {
      const disabledIds = new Set((sourceConfig.disabledTagIds as string[] | undefined) ?? [])
      const enabledDefs = connectorConfig.tagDefinitions.filter((td) => !disabledIds.has(td.id))

      const existingDefs = await db
        .select({ tagSlot: knowledgeBaseTagDefinitions.tagSlot })
        .from(knowledgeBaseTagDefinitions)
        .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

      const usedSlots = new Set<string>(existingDefs.map((d) => d.tagSlot))
      const { mapping, skipped: skippedTags } = allocateTagSlots(enabledDefs, usedSlots)
      Object.assign(tagSlotMapping, mapping)

      for (const name of skippedTags) {
        logger.warn(`[${requestId}] No available slots for "${name}"`)
      }

      if (skippedTags.length > 0 && Object.keys(tagSlotMapping).length === 0) {
        return NextResponse.json(
          { error: `No available tag slots. Could not assign: ${skippedTags.join(', ')}` },
          { status: 422 }
        )
      }

      finalSourceConfig = { ...sourceConfig, tagSlotMapping }
    }

    const now = new Date()
    const connectorId = crypto.randomUUID()
    const nextSyncAt =
      syncIntervalMinutes > 0 ? new Date(now.getTime() + syncIntervalMinutes * 60 * 1000) : null

    await db.transaction(async (tx) => {
      for (const [semanticId, slot] of Object.entries(tagSlotMapping)) {
        const td = connectorConfig.tagDefinitions!.find((d) => d.id === semanticId)!
        await createTagDefinition(
          {
            knowledgeBaseId,
            tagSlot: slot,
            displayName: td.displayName,
            fieldType: td.fieldType,
          },
          requestId,
          tx
        )
      }

      await tx.insert(knowledgeConnector).values({
        id: connectorId,
        knowledgeBaseId,
        connectorType,
        credentialId,
        sourceConfig: finalSourceConfig,
        syncIntervalMinutes,
        status: 'active',
        nextSyncAt,
        createdAt: now,
        updatedAt: now,
      })
    })

    logger.info(`[${requestId}] Created connector ${connectorId} for KB ${knowledgeBaseId}`)

    dispatchSync(connectorId, { requestId }).catch((error) => {
      logger.error(
        `[${requestId}] Failed to dispatch initial sync for connector ${connectorId}`,
        error
      )
    })

    const created = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, connectorId))
      .limit(1)

    return NextResponse.json({ success: true, data: created[0] }, { status: 201 })
  } catch (error) {
    logger.error(`[${requestId}] Error creating connector`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
