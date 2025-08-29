import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  deleteDocument,
  markDocumentAsFailedTimeout,
  retryDocumentProcessing,
  updateDocument,
} from '@/lib/knowledge/documents/service'
import { createLogger } from '@/lib/logs/console/logger'
import { checkDocumentAccess, checkDocumentWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('DocumentByIdAPI')

const UpdateDocumentSchema = z.object({
  filename: z.string().min(1, 'Filename is required').optional(),
  enabled: z.boolean().optional(),
  chunkCount: z.number().min(0).optional(),
  tokenCount: z.number().min(0).optional(),
  characterCount: z.number().min(0).optional(),
  processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  processingError: z.string().optional(),
  markFailedDueToTimeout: z.boolean().optional(),
  retryProcessing: z.boolean().optional(),
  // Tag fields
  tag1: z.string().optional(),
  tag2: z.string().optional(),
  tag3: z.string().optional(),
  tag4: z.string().optional(),
  tag5: z.string().optional(),
  tag6: z.string().optional(),
  tag7: z.string().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, session.user.id)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
        )
        return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized document access: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info(
      `[${requestId}] Retrieved document: ${documentId} from knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: accessCheck.document,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching document`, error)
    return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, session.user.id)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
        )
        return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized document update: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = UpdateDocumentSchema.parse(body)

      const updateData: any = {}

      if (validatedData.markFailedDueToTimeout) {
        const doc = accessCheck.document

        if (doc.processingStatus !== 'processing') {
          return NextResponse.json(
            { error: `Document is not in processing state (current: ${doc.processingStatus})` },
            { status: 400 }
          )
        }

        if (!doc.processingStartedAt) {
          return NextResponse.json(
            { error: 'Document has no processing start time' },
            { status: 400 }
          )
        }

        try {
          await markDocumentAsFailedTimeout(documentId, doc.processingStartedAt, requestId)

          return NextResponse.json({
            success: true,
            data: {
              documentId,
              status: 'failed',
              message: 'Document marked as failed due to timeout',
            },
          })
        } catch (error) {
          if (error instanceof Error) {
            return NextResponse.json({ error: error.message }, { status: 400 })
          }
          throw error
        }
      } else if (validatedData.retryProcessing) {
        const doc = accessCheck.document

        if (doc.processingStatus !== 'failed') {
          return NextResponse.json({ error: 'Document is not in failed state' }, { status: 400 })
        }

        const docData = {
          filename: doc.filename,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
        }

        const result = await retryDocumentProcessing(
          knowledgeBaseId,
          documentId,
          docData,
          requestId
        )

        return NextResponse.json({
          success: true,
          data: {
            documentId,
            status: result.status,
            message: result.message,
          },
        })
      } else {
        const updatedDocument = await updateDocument(documentId, validatedData, requestId)

        logger.info(
          `[${requestId}] Document updated: ${documentId} in knowledge base ${knowledgeBaseId}`
        )

        return NextResponse.json({
          success: true,
          data: updatedDocument,
        })
      }
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid document update data`, {
          errors: validationError.errors,
          documentId,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating document ${documentId}`, error)
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document delete attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, session.user.id)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
        )
        return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized document deletion: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await deleteDocument(documentId, requestId)

    logger.info(
      `[${requestId}] Document deleted: ${documentId} from knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting document`, error)
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }
}
