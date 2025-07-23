import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document, embedding } from '@/db/schema'
import { checkDocumentAccess, checkDocumentWriteAccess, processDocumentAsync } from '../../../utils'

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

      // Handle special operations first
      if (validatedData.markFailedDueToTimeout) {
        // Mark document as failed due to timeout (replaces mark-failed endpoint)
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

        const now = new Date()
        const processingDuration = now.getTime() - new Date(doc.processingStartedAt).getTime()
        const DEAD_PROCESS_THRESHOLD_MS = 150 * 1000

        if (processingDuration <= DEAD_PROCESS_THRESHOLD_MS) {
          return NextResponse.json(
            { error: 'Document has not been processing long enough to be considered dead' },
            { status: 400 }
          )
        }

        updateData.processingStatus = 'failed'
        updateData.processingError =
          'Processing timed out - background process may have been terminated'
        updateData.processingCompletedAt = now

        logger.info(
          `[${requestId}] Marked document ${documentId} as failed due to dead process (processing time: ${Math.round(processingDuration / 1000)}s)`
        )
      } else if (validatedData.retryProcessing) {
        // Retry processing (replaces retry endpoint)
        const doc = accessCheck.document

        if (doc.processingStatus !== 'failed') {
          return NextResponse.json({ error: 'Document is not in failed state' }, { status: 400 })
        }

        // Clear existing embeddings and reset document state
        await db.transaction(async (tx) => {
          await tx.delete(embedding).where(eq(embedding.documentId, documentId))

          await tx
            .update(document)
            .set({
              processingStatus: 'pending',
              processingStartedAt: null,
              processingCompletedAt: null,
              processingError: null,
              chunkCount: 0,
              tokenCount: 0,
              characterCount: 0,
            })
            .where(eq(document.id, documentId))
        })

        const processingOptions = {
          chunkSize: 1024,
          minCharactersPerChunk: 24,
          recipe: 'default',
          lang: 'en',
        }

        const docData = {
          filename: doc.filename,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
        }

        processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions).catch(
          (error: unknown) => {
            logger.error(`[${requestId}] Background retry processing error:`, error)
          }
        )

        logger.info(`[${requestId}] Document retry initiated: ${documentId}`)

        return NextResponse.json({
          success: true,
          data: {
            documentId,
            status: 'pending',
            message: 'Document retry processing started',
          },
        })
      } else {
        // Regular field updates
        if (validatedData.filename !== undefined) updateData.filename = validatedData.filename
        if (validatedData.enabled !== undefined) updateData.enabled = validatedData.enabled
        if (validatedData.chunkCount !== undefined) updateData.chunkCount = validatedData.chunkCount
        if (validatedData.tokenCount !== undefined) updateData.tokenCount = validatedData.tokenCount
        if (validatedData.characterCount !== undefined)
          updateData.characterCount = validatedData.characterCount
        if (validatedData.processingStatus !== undefined)
          updateData.processingStatus = validatedData.processingStatus
        if (validatedData.processingError !== undefined)
          updateData.processingError = validatedData.processingError
      }

      await db.update(document).set(updateData).where(eq(document.id, documentId))

      // Fetch the updated document
      const updatedDocument = await db
        .select()
        .from(document)
        .where(eq(document.id, documentId))
        .limit(1)

      logger.info(
        `[${requestId}] Document updated: ${documentId} in knowledge base ${knowledgeBaseId}`
      )

      return NextResponse.json({
        success: true,
        data: updatedDocument[0],
      })
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

    // Soft delete by setting deletedAt timestamp
    await db
      .update(document)
      .set({
        deletedAt: new Date(),
      })
      .where(eq(document.id, documentId))

    logger.info(
      `[${requestId}] Document deleted: ${documentId} from knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: { message: 'Document deleted successfully' },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting document`, error)
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }
}
