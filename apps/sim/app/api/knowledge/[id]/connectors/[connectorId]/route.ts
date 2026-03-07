import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { cleanupUnusedTagDefinitions } from '@/lib/knowledge/tags/service'
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

    if (parsed.data.sourceConfig !== undefined) {
      const existingRows = await db
        .select()
        .from(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
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
    }

    await db
      .update(knowledgeConnector)
      .set(updates)
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
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
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .limit(1)

    const { encryptedApiKey: __, ...updatedData } = updated[0]
    return NextResponse.json({ success: true, data: updatedData })
  } catch (error) {
    logger.error(`[${requestId}] Error updating connector`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/knowledge/[id]/connectors/[connectorId] - Soft-delete a connector
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

    await db
      .update(knowledgeConnector)
      .set({ deletedAt: new Date(), status: 'paused', updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
          isNull(knowledgeConnector.deletedAt)
        )
      )

    // Soft-delete all documents belonging to this connector
    await db
      .update(document)
      .set({ deletedAt: new Date() })
      .where(and(eq(document.connectorId, connectorId), isNull(document.deletedAt)))

    // Reclaim tag slots that are no longer used by any active connector
    await cleanupUnusedTagDefinitions(knowledgeBaseId, requestId).catch((error) => {
      logger.warn(`[${requestId}] Failed to cleanup tag definitions`, error)
    })

    logger.info(`[${requestId}] Soft-deleted connector ${connectorId} and its documents`)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting connector`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
