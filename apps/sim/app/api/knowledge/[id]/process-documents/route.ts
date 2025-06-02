import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document } from '@/db/schema'
import { checkKnowledgeBaseAccess, processDocumentAsync } from '../../utils'

const logger = createLogger('ProcessDocumentsAPI')

const ProcessDocumentsSchema = z.object({
  documents: z.array(
    z.object({
      filename: z.string().min(1, 'Filename is required'),
      fileUrl: z.string().url('File URL must be valid'),
      fileSize: z.number().min(1, 'File size must be greater than 0'),
      mimeType: z.string().min(1, 'MIME type is required'),
      fileHash: z.string().optional(),
    })
  ),
  processingOptions: z.object({
    chunkSize: z.number(),
    minCharactersPerChunk: z.number(),
    recipe: z.string(),
    lang: z.string(),
  }),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized document processing attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to process documents in unauthorized knowledge base ${knowledgeBaseId}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = ProcessDocumentsSchema.parse(body)

      // Create document records first
      const documentPromises = validatedData.documents.map(async (docData) => {
        const documentId = crypto.randomUUID()
        const now = new Date()

        const newDocument = {
          id: documentId,
          knowledgeBaseId,
          filename: docData.filename,
          fileUrl: docData.fileUrl,
          fileSize: docData.fileSize,
          mimeType: docData.mimeType,
          fileHash: docData.fileHash || null,
          chunkCount: 0,
          tokenCount: 0,
          characterCount: 0,
          processingStatus: 'pending' as const,
          enabled: true,
          uploadedAt: now,
        }

        await db.insert(document).values(newDocument)
        return { documentId, ...docData }
      })

      const createdDocuments = await Promise.all(documentPromises)

      // Start processing documents asynchronously in parallel
      logger.info(
        `[${requestId}] Starting async processing of ${createdDocuments.length} documents`
      )

      // Process all documents in parallel without waiting
      const processingPromises = createdDocuments.map(async (doc) => {
        return processDocumentAsync(
          knowledgeBaseId,
          doc.documentId,
          {
            filename: doc.filename,
            fileUrl: doc.fileUrl,
            fileSize: doc.fileSize,
            mimeType: doc.mimeType,
            fileHash: doc.fileHash,
          },
          validatedData.processingOptions
        )
      })

      // Don't await the processing - let it run in background
      Promise.all(processingPromises).catch((error) => {
        logger.error(`[${requestId}] Background processing error:`, error)
      })

      return NextResponse.json({
        success: true,
        data: {
          total: createdDocuments.length,
          documentsCreated: createdDocuments.map((doc) => ({
            documentId: doc.documentId,
            filename: doc.filename,
            status: 'pending',
          })),
          processingMethod: 'background',
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid processing request data`, {
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
    logger.error(`[${requestId}] Error processing documents`, error)
    return NextResponse.json({ error: 'Failed to process documents' }, { status: 500 })
  }
}
