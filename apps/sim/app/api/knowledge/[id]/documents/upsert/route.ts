import { db } from '@sim/db'
import { document } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateId } from '@/lib/core/utils/uuid'
import {
  createDocumentRecords,
  deleteDocument,
  getProcessingConfig,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('DocumentUpsertAPI')

const UpsertDocumentSchema = z.object({
  documentId: z.string().optional(),
  filename: z.string().min(1, 'Filename is required'),
  fileUrl: z.string().min(1, 'File URL is required'),
  fileSize: z.number().min(1, 'File size must be greater than 0'),
  mimeType: z.string().min(1, 'MIME type is required'),
  documentTagsData: z.string().optional(),
  processingOptions: z
    .object({
      recipe: z.string().optional(),
      lang: z.string().optional(),
    })
    .optional(),
  workflowId: z.string().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateId().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    const body = await req.json()

    logger.info(`[${requestId}] Knowledge base document upsert request`, {
      knowledgeBaseId,
      hasDocumentId: !!body.documentId,
      filename: body.filename,
    })

    const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Authentication failed: ${auth.error || 'Unauthorized'}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

    const validatedData = UpsertDocumentSchema.parse(body)

    if (validatedData.workflowId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId: validatedData.workflowId,
        userId,
        action: 'write',
      })
      if (!authorization.allowed) {
        return NextResponse.json(
          { error: authorization.message || 'Access denied' },
          { status: authorization.status }
        )
      }
    }

    const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted to upsert document in unauthorized knowledge base ${knowledgeBaseId}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let existingDocumentId: string | null = null
    let isUpdate = false

    if (validatedData.documentId) {
      const existingDoc = await db
        .select({ id: document.id })
        .from(document)
        .where(
          and(
            eq(document.id, validatedData.documentId),
            eq(document.knowledgeBaseId, knowledgeBaseId),
            isNull(document.deletedAt)
          )
        )
        .limit(1)

      if (existingDoc.length > 0) {
        existingDocumentId = existingDoc[0].id
      }
    } else {
      const docsByFilename = await db
        .select({ id: document.id })
        .from(document)
        .where(
          and(
            eq(document.filename, validatedData.filename),
            eq(document.knowledgeBaseId, knowledgeBaseId),
            isNull(document.deletedAt)
          )
        )
        .limit(1)

      if (docsByFilename.length > 0) {
        existingDocumentId = docsByFilename[0].id
      }
    }

    if (existingDocumentId) {
      isUpdate = true
      logger.info(
        `[${requestId}] Found existing document ${existingDocumentId}, creating replacement before deleting old`
      )
    }

    const createdDocuments = await createDocumentRecords(
      [
        {
          filename: validatedData.filename,
          fileUrl: validatedData.fileUrl,
          fileSize: validatedData.fileSize,
          mimeType: validatedData.mimeType,
          ...(validatedData.documentTagsData && {
            documentTagsData: validatedData.documentTagsData,
          }),
        },
      ],
      knowledgeBaseId,
      requestId
    )

    const firstDocument = createdDocuments[0]
    if (!firstDocument) {
      logger.error(`[${requestId}] createDocumentRecords returned empty array unexpectedly`)
      return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 })
    }

    if (existingDocumentId) {
      try {
        await deleteDocument(existingDocumentId, requestId)
      } catch (deleteError) {
        logger.error(
          `[${requestId}] Failed to delete old document ${existingDocumentId}, rolling back new record`,
          deleteError
        )
        await deleteDocument(firstDocument.documentId, requestId).catch(() => {})
        return NextResponse.json({ error: 'Failed to replace existing document' }, { status: 500 })
      }
    }

    processDocumentsWithQueue(
      createdDocuments,
      knowledgeBaseId,
      validatedData.processingOptions ?? {},
      requestId
    ).catch((error: unknown) => {
      logger.error(`[${requestId}] Critical error in document processing pipeline:`, error)
    })

    try {
      const { PlatformEvents } = await import('@/lib/core/telemetry')
      PlatformEvents.knowledgeBaseDocumentsUploaded({
        knowledgeBaseId,
        documentsCount: 1,
        uploadType: 'single',
        recipe: validatedData.processingOptions?.recipe,
      })
    } catch (_e) {
      // Silently fail
    }

    recordAudit({
      workspaceId: accessCheck.knowledgeBase?.workspaceId ?? null,
      actorId: userId,
      actorName: auth.userName,
      actorEmail: auth.userEmail,
      action: isUpdate ? AuditAction.DOCUMENT_UPDATED : AuditAction.DOCUMENT_UPLOADED,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: knowledgeBaseId,
      resourceName: validatedData.filename,
      description: isUpdate
        ? `Upserted (replaced) document "${validatedData.filename}" in knowledge base "${knowledgeBaseId}"`
        : `Upserted (created) document "${validatedData.filename}" in knowledge base "${knowledgeBaseId}"`,
      metadata: {
        fileName: validatedData.filename,
        previousDocumentId: existingDocumentId,
        isUpdate,
      },
      request: req,
    })

    return NextResponse.json({
      success: true,
      data: {
        documentsCreated: [
          {
            documentId: firstDocument.documentId,
            filename: firstDocument.filename,
            status: 'pending',
          },
        ],
        isUpdate,
        previousDocumentId: existingDocumentId,
        processingMethod: 'background',
        processingConfig: {
          maxConcurrentDocuments: getProcessingConfig().maxConcurrentDocuments,
          batchSize: getProcessingConfig().batchSize,
        },
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid upsert request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error upserting document`, error)

    const errorMessage = error instanceof Error ? error.message : 'Failed to upsert document'
    const isStorageLimitError =
      errorMessage.includes('Storage limit exceeded') || errorMessage.includes('storage limit')
    const isMissingKnowledgeBase = errorMessage === 'Knowledge base not found'

    return NextResponse.json(
      { error: errorMessage },
      { status: isMissingKnowledgeBase ? 404 : isStorageLimitError ? 413 : 500 }
    )
  }
}
