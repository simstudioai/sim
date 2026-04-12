import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { hasLiveSyncAccess } from '@/lib/billing/core/subscription'
import { generateRequestId } from '@/lib/core/utils/request'
import { deleteDocumentStorageFiles } from '@/lib/knowledge/documents/service'
import { cleanupUnusedTagDefinitions } from '@/lib/knowledge/tags/service'
import { captureServerEvent } from '@/lib/posthog/server'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'

const logger = createLogger('KnowledgeConnectorByIdAPI')

type RouteParams = { params: Promise<{ id: string; connectorId: string }> }

const UpdateConnectorSchema = z.object({
  sourceConfig: z.record(z.unknown()).optional(),
  syncIntervalMinutes: z.number().int().min(0).optional(),
  status: z.enum(['active', 'paused']).optional(),
})

/**
 * GET /api/knowledge/[id]/connectors/[connectorId] - Get connector details with recent sync logs
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, connectorId } = await params

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

    const connectorRows = await db
      .select()
      .from(knowledgeConnector)
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .limit(1)

    if (connectorRows.length === 0) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 })
    }

    const syncLogs = await db
      .select()
      .from(knowledgeConnectorSyncLog)
      .where(eq(knowledgeConnectorSyncLog.connectorId, connectorId))
      .orderBy(desc(knowledgeConnectorSyncLog.startedAt))
      .limit(10)

    const { encryptedApiKey: _, ...connectorData } = connectorRows[0]
    return NextResponse.json({
      success: true,
      data: {
        ...connectorData,
        syncLogs,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching connector`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/knowledge/[id]/connectors/[connectorId] - Update a connector
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, connectorId } = await params

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
    const parsed = UpdateConnectorSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    if (
      parsed.data.syncIntervalMinutes !== undefined &&
      parsed.data.syncIntervalMinutes > 0 &&
      parsed.data.syncIntervalMinutes < 60
    ) {
      const canUseLiveSync = await hasLiveSyncAccess(auth.userId)
      if (!canUseLiveSync) {
        return NextResponse.json(
          { error: 'Live sync requires a Max or Enterprise plan' },
          { status: 403 }
        )
      }
    }

    if (parsed.data.sourceConfig !== undefined) {
      const existingRows = await db
        .select()
        .from(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .limit(1)

      if (existingRows.length === 0) {
        return NextResponse.json({ error: 'Connector not found' }, { status: 404 })
      }

      const existing = existingRows[0]
      const connectorConfig = CONNECTOR_REGISTRY[existing.connectorType]

      if (!connectorConfig) {
        return NextResponse.json(
          { error: `Unknown connector type: ${existing.connectorType}` },
          { status: 400 }
        )
      }

      const kbRows = await db
        .select({ userId: knowledgeBase.userId })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, knowledgeBaseId))
        .limit(1)

      if (kbRows.length === 0) {
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }

      let accessToken: string | null = null
      if (connectorConfig.auth.mode === 'apiKey') {
        if (!existing.encryptedApiKey) {
          return NextResponse.json(
            { error: 'API key not found. Please reconfigure the connector.' },
            { status: 400 }
          )
        }
        accessToken = (await decryptApiKey(existing.encryptedApiKey)).decrypted
      } else {
        if (!existing.credentialId) {
          return NextResponse.json(
            { error: 'OAuth credential not found. Please reconfigure the connector.' },
            { status: 400 }
          )
        }
        accessToken = await refreshAccessTokenIfNeeded(
          existing.credentialId,
          kbRows[0].userId,
          `patch-${connectorId}`
        )
      }

      if (!accessToken) {
        return NextResponse.json(
          { error: 'Failed to refresh access token. Please reconnect your account.' },
          { status: 401 }
        )
      }

      const validation = await connectorConfig.validateConfig(accessToken, parsed.data.sourceConfig)
      if (!validation.valid) {
        return NextResponse.json(
          { error: validation.error || 'Invalid source configuration' },
          { status: 400 }
        )
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.data.sourceConfig !== undefined) {
      updates.sourceConfig = parsed.data.sourceConfig
    }
    if (parsed.data.syncIntervalMinutes !== undefined) {
      updates.syncIntervalMinutes = parsed.data.syncIntervalMinutes
      if (parsed.data.syncIntervalMinutes > 0) {
        updates.nextSyncAt = new Date(Date.now() + parsed.data.syncIntervalMinutes * 60 * 1000)
      } else {
        updates.nextSyncAt = null
      }
    }
    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status
      if (parsed.data.status === 'active') {
        updates.consecutiveFailures = 0
        updates.lastSyncError = null
        if (updates.nextSyncAt === undefined) {
          updates.nextSyncAt = new Date()
        }
      }
    }

    await db
      .update(knowledgeConnector)
      .set(updates)
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )

    const updated = await db
      .select()
      .from(knowledgeConnector)
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .limit(1)

    const { encryptedApiKey: __, ...updatedData } = updated[0]

    recordAudit({
      workspaceId: writeCheck.knowledgeBase.workspaceId,
      actorId: auth.userId,
      actorName: auth.userName,
      actorEmail: auth.userEmail,
      action: AuditAction.CONNECTOR_UPDATED,
      resourceType: AuditResourceType.CONNECTOR,
      resourceId: connectorId,
      resourceName: updatedData.connectorType,
      description: `Updated connector for knowledge base "${writeCheck.knowledgeBase.name}"`,
      metadata: {
        knowledgeBaseId,
        knowledgeBaseName: writeCheck.knowledgeBase.name,
        connectorType: updatedData.connectorType,
        updatedFields: Object.keys(parsed.data),
        ...(parsed.data.syncIntervalMinutes !== undefined && {
          syncIntervalMinutes: parsed.data.syncIntervalMinutes,
        }),
        ...(parsed.data.status !== undefined && { newStatus: parsed.data.status }),
      },
      request,
    })

    return NextResponse.json({ success: true, data: updatedData })
  } catch (error) {
    logger.error(`[${requestId}] Error updating connector`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/knowledge/[id]/connectors/[connectorId] - Hard-delete a connector
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, connectorId } = await params

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

    const existingConnector = await db
      .select({ id: knowledgeConnector.id, connectorType: knowledgeConnector.connectorType })
      .from(knowledgeConnector)
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .limit(1)

    if (existingConnector.length === 0) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const deleteDocuments = searchParams.get('deleteDocuments') === 'true'

    const { deletedDocs, docCount } = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM knowledge_connector WHERE id = ${connectorId} FOR UPDATE`)

      const docs = await tx
        .select({ id: document.id, fileUrl: document.fileUrl })
        .from(document)
        .where(
          and(
            eq(document.connectorId, connectorId),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        )

      if (deleteDocuments) {
        const documentIds = docs.map((doc) => doc.id)
        if (documentIds.length > 0) {
          await tx.delete(embedding).where(inArray(embedding.documentId, documentIds))
          await tx.delete(document).where(inArray(document.id, documentIds))
        }
      }

      const deletedConnectors = await tx
        .delete(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .returning({ id: knowledgeConnector.id })

      if (deletedConnectors.length === 0) {
        throw new Error('Connector not found')
      }

      return { deletedDocs: deleteDocuments ? docs : [], docCount: docs.length }
    })

    if (deleteDocuments) {
      await Promise.all([
        deletedDocs.length > 0
          ? deleteDocumentStorageFiles(deletedDocs, requestId)
          : Promise.resolve(),
        cleanupUnusedTagDefinitions(knowledgeBaseId, requestId).catch((error) => {
          logger.warn(`[${requestId}] Failed to cleanup tag definitions`, error)
        }),
      ])
    }

    logger.info(
      `[${requestId}] Deleted connector ${connectorId}${deleteDocuments ? ` and ${docCount} documents` : `, kept ${docCount} documents`}`
    )

    const kbWorkspaceId = writeCheck.knowledgeBase.workspaceId ?? ''
    captureServerEvent(
      auth.userId,
      'knowledge_base_connector_removed',
      {
        knowledge_base_id: knowledgeBaseId,
        workspace_id: kbWorkspaceId,
        connector_type: existingConnector[0].connectorType,
        documents_deleted: deleteDocuments ? docCount : 0,
      },
      kbWorkspaceId ? { groups: { workspace: kbWorkspaceId } } : undefined
    )

    recordAudit({
      workspaceId: writeCheck.knowledgeBase.workspaceId,
      actorId: auth.userId,
      actorName: auth.userName,
      actorEmail: auth.userEmail,
      action: AuditAction.CONNECTOR_DELETED,
      resourceType: AuditResourceType.CONNECTOR,
      resourceId: connectorId,
      resourceName: existingConnector[0].connectorType,
      description: `Deleted connector from knowledge base "${writeCheck.knowledgeBase.name}"`,
      metadata: {
        knowledgeBaseId,
        knowledgeBaseName: writeCheck.knowledgeBase.name,
        connectorType: existingConnector[0].connectorType,
        deleteDocuments,
        documentsDeleted: deleteDocuments ? docCount : 0,
        documentsKept: deleteDocuments ? 0 : docCount,
      },
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting connector`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
