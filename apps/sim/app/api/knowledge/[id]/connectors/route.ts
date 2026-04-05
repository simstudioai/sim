import { db } from '@sim/db'
import { knowledgeBase, knowledgeBaseTagDefinitions, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { encryptApiKey } from '@/lib/api-key/crypto'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { hasLiveSyncAccess } from '@/lib/billing/core/subscription'
import { generateRequestId } from '@/lib/core/utils/request'
import { dispatchSync } from '@/lib/knowledge/connectors/sync-engine'
import { allocateTagSlots } from '@/lib/knowledge/constants'
import { createTagDefinition } from '@/lib/knowledge/tags/service'
import { captureServerEvent } from '@/lib/posthog/server'
import { getCredential } from '@/app/api/auth/oauth/utils'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'

const logger = createLogger('KnowledgeConnectorsAPI')

const CreateConnectorSchema = z.object({
  connectorType: z.string().min(1),
  credentialId: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
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
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .orderBy(desc(knowledgeConnector.createdAt))

    return NextResponse.json({
      success: true,
      data: connectors.map(({ encryptedApiKey: _, ...rest }) => rest),
    })
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

    const { connectorType, credentialId, apiKey, sourceConfig, syncIntervalMinutes } = parsed.data

    if (syncIntervalMinutes > 0 && syncIntervalMinutes < 60) {
      const canUseLiveSync = await hasLiveSyncAccess(auth.userId)
      if (!canUseLiveSync) {
        return NextResponse.json(
          { error: 'Live sync requires a Max or Enterprise plan' },
          { status: 403 }
        )
      }
    }

    const connectorConfig = CONNECTOR_REGISTRY[connectorType]
    if (!connectorConfig) {
      return NextResponse.json(
        { error: `Unknown connector type: ${connectorType}` },
        { status: 400 }
      )
    }

    let resolvedCredentialId: string | null = null
    let resolvedEncryptedApiKey: string | null = null
    let accessToken: string

    if (connectorConfig.auth.mode === 'apiKey') {
      if (!apiKey) {
        return NextResponse.json({ error: 'API key is required' }, { status: 400 })
      }
      accessToken = apiKey
    } else {
      if (!credentialId) {
        return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
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

      accessToken = credential.accessToken
      resolvedCredentialId = credentialId
    }

    const validation = await connectorConfig.validateConfig(accessToken, sourceConfig)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid source configuration' },
        { status: 400 }
      )
    }

    let finalSourceConfig: Record<string, unknown> = { ...sourceConfig }

    if (connectorConfig.auth.mode === 'apiKey' && apiKey) {
      const { encrypted } = await encryptApiKey(apiKey)
      resolvedEncryptedApiKey = encrypted
    }

    const tagSlotMapping: Record<string, string> = {}
    let newTagSlots: Record<string, string> = {}

    if (connectorConfig.tagDefinitions?.length) {
      const disabledIds = new Set((sourceConfig.disabledTagIds as string[] | undefined) ?? [])
      const enabledDefs = connectorConfig.tagDefinitions.filter((td) => !disabledIds.has(td.id))

      const existingDefs = await db
        .select({
          tagSlot: knowledgeBaseTagDefinitions.tagSlot,
          displayName: knowledgeBaseTagDefinitions.displayName,
          fieldType: knowledgeBaseTagDefinitions.fieldType,
        })
        .from(knowledgeBaseTagDefinitions)
        .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

      const usedSlots = new Set<string>(existingDefs.map((d) => d.tagSlot))
      const existingByName = new Map(
        existingDefs.map((d) => [d.displayName, { tagSlot: d.tagSlot, fieldType: d.fieldType }])
      )

      const defsNeedingSlots: typeof enabledDefs = []
      for (const td of enabledDefs) {
        const existing = existingByName.get(td.displayName)
        if (existing && existing.fieldType === td.fieldType) {
          tagSlotMapping[td.id] = existing.tagSlot
        } else {
          defsNeedingSlots.push(td)
        }
      }

      const { mapping, skipped: skippedTags } = allocateTagSlots(defsNeedingSlots, usedSlots)
      Object.assign(tagSlotMapping, mapping)
      newTagSlots = mapping

      for (const name of skippedTags) {
        logger.warn(`[${requestId}] No available slots for "${name}"`)
      }

      if (skippedTags.length > 0 && Object.keys(tagSlotMapping).length === 0) {
        return NextResponse.json(
          { error: `No available tag slots. Could not assign: ${skippedTags.join(', ')}` },
          { status: 422 }
        )
      }

      finalSourceConfig = { ...finalSourceConfig, tagSlotMapping }
    }

    const now = new Date()
    const connectorId = crypto.randomUUID()
    const nextSyncAt =
      syncIntervalMinutes > 0 ? new Date(now.getTime() + syncIntervalMinutes * 60 * 1000) : null

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

      const activeKb = await tx
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
        .limit(1)

      if (activeKb.length === 0) {
        throw new Error('Knowledge base not found')
      }

      for (const [semanticId, slot] of Object.entries(newTagSlots)) {
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
        credentialId: resolvedCredentialId,
        encryptedApiKey: resolvedEncryptedApiKey,
        sourceConfig: finalSourceConfig,
        syncIntervalMinutes,
        status: 'active',
        nextSyncAt,
        createdAt: now,
        updatedAt: now,
      })
    })

    logger.info(`[${requestId}] Created connector ${connectorId} for KB ${knowledgeBaseId}`)

    const kbWorkspaceId = writeCheck.knowledgeBase.workspaceId ?? ''
    captureServerEvent(
      auth.userId,
      'knowledge_base_connector_added',
      {
        knowledge_base_id: knowledgeBaseId,
        workspace_id: kbWorkspaceId,
        connector_type: connectorType,
        sync_interval_minutes: syncIntervalMinutes,
      },
      {
        groups: kbWorkspaceId ? { workspace: kbWorkspaceId } : undefined,
        setOnce: { first_connector_added_at: new Date().toISOString() },
      }
    )

    recordAudit({
      workspaceId: writeCheck.knowledgeBase.workspaceId,
      actorId: auth.userId,
      actorName: auth.userName,
      actorEmail: auth.userEmail,
      action: AuditAction.CONNECTOR_CREATED,
      resourceType: AuditResourceType.CONNECTOR,
      resourceId: connectorId,
      resourceName: connectorType,
      description: `Created ${connectorType} connector for knowledge base "${writeCheck.knowledgeBase.name}"`,
      metadata: { knowledgeBaseId, connectorType, syncIntervalMinutes },
      request,
    })

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

    const { encryptedApiKey: _, ...createdData } = created[0]
    return NextResponse.json({ success: true, data: createdData }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Knowledge base not found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    logger.error(`[${requestId}] Error creating connector`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
