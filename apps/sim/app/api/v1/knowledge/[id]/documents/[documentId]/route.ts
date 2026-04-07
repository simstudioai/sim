import { db } from '@sim/db'
import { document, knowledgeConnector } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { deleteDocument } from '@/lib/knowledge/documents/service'
import {
  authenticateRequest,
  handleError,
  resolveKnowledgeBase,
  serializeDate,
  validateSchema,
} from '@/app/api/v1/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface DocumentDetailRouteParams {
  params: Promise<{ id: string; documentId: string }>
}

const WorkspaceIdSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
})

/** GET /api/v1/knowledge/[id]/documents/[documentId] — Get document details. */
export async function GET(request: NextRequest, { params }: DocumentDetailRouteParams) {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const { id: knowledgeBaseId, documentId } = await params
    const { searchParams } = new URL(request.url)

    const validation = validateSchema(WorkspaceIdSchema, {
      workspaceId: searchParams.get('workspaceId'),
    })
    if (!validation.success) return validation.response

    const result = await resolveKnowledgeBase(
      knowledgeBaseId,
      validation.data.workspaceId,
      userId,
      rateLimit
    )
    if (result instanceof NextResponse) return result

    const docs = await db
      .select({
        id: document.id,
        knowledgeBaseId: document.knowledgeBaseId,
        filename: document.filename,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        processingStatus: document.processingStatus,
        processingError: document.processingError,
        processingStartedAt: document.processingStartedAt,
        processingCompletedAt: document.processingCompletedAt,
        chunkCount: document.chunkCount,
        tokenCount: document.tokenCount,
        characterCount: document.characterCount,
        enabled: document.enabled,
        uploadedAt: document.uploadedAt,
        connectorId: document.connectorId,
        connectorType: knowledgeConnector.connectorType,
        sourceUrl: document.sourceUrl,
      })
      .from(document)
      .leftJoin(knowledgeConnector, eq(document.connectorId, knowledgeConnector.id))
      .where(
        and(
          eq(document.id, documentId),
          eq(document.knowledgeBaseId, knowledgeBaseId),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
      .limit(1)

    if (docs.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const doc = docs[0]

    return NextResponse.json({
      success: true,
      data: {
        document: {
          id: doc.id,
          knowledgeBaseId: doc.knowledgeBaseId,
          filename: doc.filename,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          processingStatus: doc.processingStatus,
          processingError: doc.processingError,
          processingStartedAt: serializeDate(doc.processingStartedAt),
          processingCompletedAt: serializeDate(doc.processingCompletedAt),
          chunkCount: doc.chunkCount,
          tokenCount: doc.tokenCount,
          characterCount: doc.characterCount,
          enabled: doc.enabled,
          connectorId: doc.connectorId,
          connectorType: doc.connectorType,
          sourceUrl: doc.sourceUrl,
          createdAt: serializeDate(doc.uploadedAt),
        },
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to get document')
  }
}

/** DELETE /api/v1/knowledge/[id]/documents/[documentId] — Delete a document. */
export async function DELETE(request: NextRequest, { params }: DocumentDetailRouteParams) {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const { id: knowledgeBaseId, documentId } = await params
    const { searchParams } = new URL(request.url)

    const validation = validateSchema(WorkspaceIdSchema, {
      workspaceId: searchParams.get('workspaceId'),
    })
    if (!validation.success) return validation.response

    const result = await resolveKnowledgeBase(
      knowledgeBaseId,
      validation.data.workspaceId,
      userId,
      rateLimit,
      'write'
    )
    if (result instanceof NextResponse) return result

    const docs = await db
      .select({ id: document.id, filename: document.filename })
      .from(document)
      .where(
        and(
          eq(document.id, documentId),
          eq(document.knowledgeBaseId, knowledgeBaseId),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
      .limit(1)

    if (docs.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    await deleteDocument(documentId, requestId)

    recordAudit({
      workspaceId: validation.data.workspaceId,
      actorId: userId,
      action: AuditAction.DOCUMENT_DELETED,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: documentId,
      resourceName: docs[0].filename,
      description: `Deleted document "${docs[0].filename}" from knowledge base via API`,
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        message: 'Document deleted successfully',
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to delete document')
  }
}
