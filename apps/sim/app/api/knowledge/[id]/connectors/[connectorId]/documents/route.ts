import { db } from '@sim/db'
import { document, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('ConnectorDocumentsAPI')

type RouteParams = { params: Promise<{ id: string; connectorId: string }> }

/**
 * GET /api/knowledge/[id]/connectors/[connectorId]/documents
 * Returns documents for a connector, optionally including user-excluded ones.
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
      .select({ id: knowledgeConnector.id })
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

    const includeExcluded = request.nextUrl.searchParams.get('includeExcluded') === 'true'

    const activeDocs = await db
      .select({
        id: document.id,
        filename: document.filename,
        externalId: document.externalId,
        sourceUrl: document.sourceUrl,
        enabled: document.enabled,
        userExcluded: document.userExcluded,
        uploadedAt: document.uploadedAt,
        processingStatus: document.processingStatus,
      })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          isNull(document.deletedAt),
          eq(document.userExcluded, false)
        )
      )
      .orderBy(document.filename)

    const excludedDocs = includeExcluded
      ? await db
          .select({
            id: document.id,
            filename: document.filename,
            externalId: document.externalId,
            sourceUrl: document.sourceUrl,
            enabled: document.enabled,
            userExcluded: document.userExcluded,
            uploadedAt: document.uploadedAt,
            processingStatus: document.processingStatus,
          })
          .from(document)
          .where(and(eq(document.connectorId, connectorId), eq(document.userExcluded, true)))
          .orderBy(document.filename)
      : []

    const docs = [...activeDocs, ...excludedDocs]
    const activeCount = activeDocs.length
    const excludedCount = excludedDocs.length

    return NextResponse.json({
      success: true,
      data: {
        documents: docs,
        counts: { active: activeCount, excluded: excludedCount },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching connector documents`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const PatchSchema = z.object({
  operation: z.enum(['restore', 'exclude']),
  documentIds: z.array(z.string()).min(1),
})

/**
 * PATCH /api/knowledge/[id]/connectors/[connectorId]/documents
 * Restore or exclude connector documents.
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
    const parsed = PatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { operation, documentIds } = parsed.data

    if (operation === 'restore') {
      const updated = await db
        .update(document)
        .set({ userExcluded: false, deletedAt: null, enabled: true })
        .where(
          and(
            eq(document.connectorId, connectorId),
            inArray(document.id, documentIds),
            eq(document.userExcluded, true)
          )
        )
        .returning({ id: document.id })

      logger.info(`[${requestId}] Restored ${updated.length} excluded documents`, { connectorId })

      return NextResponse.json({
        success: true,
        data: { restoredCount: updated.length, documentIds: updated.map((d) => d.id) },
      })
    }

    const updated = await db
      .update(document)
      .set({ userExcluded: true, deletedAt: new Date() })
      .where(
        and(
          eq(document.connectorId, connectorId),
          inArray(document.id, documentIds),
          eq(document.userExcluded, false),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id })

    logger.info(`[${requestId}] Excluded ${updated.length} documents`, { connectorId })

    return NextResponse.json({
      success: true,
      data: { excludedCount: updated.length, documentIds: updated.map((d) => d.id) },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating connector documents`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
