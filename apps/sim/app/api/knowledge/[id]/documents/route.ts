import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document } from '@/db/schema'
import { checkKnowledgeBaseAccess } from '../../utils'

const logger = createLogger('DocumentsAPI')

const CreateDocumentSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  fileUrl: z.string().url('File URL must be valid'),
  fileSize: z.number().min(1, 'File size must be greater than 0'),
  mimeType: z.string().min(1, 'MIME type is required'),
  fileHash: z.string().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized documents access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to access unauthorized knowledge base documents ${knowledgeBaseId}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const includeDisabled = url.searchParams.get('includeDisabled') === 'true'

    // Build where conditions
    const whereConditions = [
      eq(document.knowledgeBaseId, knowledgeBaseId),
      isNull(document.deletedAt),
    ]

    // Filter out disabled documents unless specifically requested
    if (!includeDisabled) {
      whereConditions.push(eq(document.enabled, true))
    }

    const documents = await db
      .select({
        id: document.id,
        knowledgeBaseId: document.knowledgeBaseId,
        filename: document.filename,
        fileUrl: document.fileUrl,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        fileHash: document.fileHash,
        chunkCount: document.chunkCount,
        tokenCount: document.tokenCount,
        characterCount: document.characterCount,
        processingStatus: document.processingStatus,
        processingStartedAt: document.processingStartedAt,
        processingCompletedAt: document.processingCompletedAt,
        processingError: document.processingError,
        enabled: document.enabled,
        uploadedAt: document.uploadedAt,
      })
      .from(document)
      .where(and(...whereConditions))
      .orderBy(document.uploadedAt)

    logger.info(
      `[${requestId}] Retrieved ${documents.length} documents for knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: documents,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching documents`, error)
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to create document in unauthorized knowledge base ${knowledgeBaseId}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = CreateDocumentSchema.parse(body)

      // Check for duplicate file hash if provided
      if (validatedData.fileHash) {
        const existingDocument = await db
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeBaseId),
              eq(document.fileHash, validatedData.fileHash),
              isNull(document.deletedAt)
            )
          )
          .limit(1)

        if (existingDocument.length > 0) {
          logger.warn(`[${requestId}] Duplicate file hash detected: ${validatedData.fileHash}`)
          return NextResponse.json(
            { error: 'Document with this file hash already exists' },
            { status: 409 }
          )
        }
      }

      const documentId = crypto.randomUUID()
      const now = new Date()

      const newDocument = {
        id: documentId,
        knowledgeBaseId,
        filename: validatedData.filename,
        fileUrl: validatedData.fileUrl,
        fileSize: validatedData.fileSize,
        mimeType: validatedData.mimeType,
        fileHash: validatedData.fileHash || null,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        enabled: true,
        uploadedAt: now,
      }

      await db.insert(document).values(newDocument)

      logger.info(
        `[${requestId}] Document created: ${documentId} in knowledge base ${knowledgeBaseId}`
      )

      return NextResponse.json({
        success: true,
        data: newDocument,
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid document data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error creating document`, error)
    return NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
  }
}
