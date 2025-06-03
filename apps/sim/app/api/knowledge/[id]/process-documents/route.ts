import { eq } from 'drizzle-orm'
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

const PROCESSING_CONFIG = {
  maxConcurrentDocuments: 3, // Limit concurrent processing to prevent resource exhaustion
  batchSize: 5, // Process documents in batches
  delayBetweenBatches: 1000, // 1 second delay between batches
  delayBetweenDocuments: 500, // 500ms delay between individual documents in a batch
}

/**
 * Process documents with concurrency control and batching
 */
async function processDocumentsWithConcurrencyControl(
  createdDocuments: Array<{
    documentId: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    fileHash?: string
  }>,
  knowledgeBaseId: string,
  processingOptions: any,
  requestId: string
): Promise<void> {
  const totalDocuments = createdDocuments.length
  const batches = []

  // Create batches
  for (let i = 0; i < totalDocuments; i += PROCESSING_CONFIG.batchSize) {
    batches.push(createdDocuments.slice(i, i + PROCESSING_CONFIG.batchSize))
  }

  logger.info(`[${requestId}] Processing ${totalDocuments} documents in ${batches.length} batches`)

  for (const [batchIndex, batch] of batches.entries()) {
    logger.info(
      `[${requestId}] Starting batch ${batchIndex + 1}/${batches.length} with ${batch.length} documents`
    )

    // Process batch with limited concurrency
    await processBatchWithConcurrency(batch, knowledgeBaseId, processingOptions, requestId)

    // Add delay between batches (except for the last batch)
    if (batchIndex < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, PROCESSING_CONFIG.delayBetweenBatches))
    }
  }

  logger.info(`[${requestId}] Completed processing initiation for all ${totalDocuments} documents`)
}

/**
 * Process a batch of documents with controlled concurrency
 */
async function processBatchWithConcurrency(
  batch: Array<{
    documentId: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    fileHash?: string
  }>,
  knowledgeBaseId: string,
  processingOptions: any,
  requestId: string
): Promise<void> {
  const semaphore = new Array(PROCESSING_CONFIG.maxConcurrentDocuments).fill(0)
  const processingPromises = batch.map(async (doc, index) => {
    // Add staggered delay to prevent overwhelming the system
    if (index > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, index * PROCESSING_CONFIG.delayBetweenDocuments)
      )
    }

    // Wait for available slot
    await new Promise<void>((resolve) => {
      const checkSlot = () => {
        const availableIndex = semaphore.findIndex((slot) => slot === 0)
        if (availableIndex !== -1) {
          semaphore[availableIndex] = 1
          resolve()
        } else {
          setTimeout(checkSlot, 100)
        }
      }
      checkSlot()
    })

    try {
      logger.info(`[${requestId}] Starting processing for document: ${doc.filename}`)

      await processDocumentAsync(
        knowledgeBaseId,
        doc.documentId,
        {
          filename: doc.filename,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          fileHash: doc.fileHash,
        },
        processingOptions
      )

      logger.info(`[${requestId}] Successfully initiated processing for document: ${doc.filename}`)
    } catch (error: unknown) {
      logger.error(`[${requestId}] Failed to process document: ${doc.filename}`, {
        documentId: doc.documentId,
        filename: doc.filename,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      })

      try {
        await db
          .update(document)
          .set({
            processingStatus: 'failed',
            processingError:
              error instanceof Error ? error.message : 'Failed to initiate processing',
            processingCompletedAt: new Date(),
          })
          .where(eq(document.id, doc.documentId))
      } catch (dbError: unknown) {
        logger.error(
          `[${requestId}] Failed to update document status for failed document: ${doc.documentId}`,
          dbError
        )
      }
    } finally {
      const slotIndex = semaphore.findIndex((slot) => slot === 1)
      if (slotIndex !== -1) {
        semaphore[slotIndex] = 0
      }
    }
  })

  await Promise.allSettled(processingPromises)
}

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

      const createdDocuments = await db.transaction(async (tx) => {
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

          await tx.insert(document).values(newDocument)
          return { documentId, ...docData }
        })

        return await Promise.all(documentPromises)
      })

      logger.info(
        `[${requestId}] Starting controlled async processing of ${createdDocuments.length} documents`
      )

      processDocumentsWithConcurrencyControl(
        createdDocuments,
        knowledgeBaseId,
        validatedData.processingOptions,
        requestId
      ).catch((error: unknown) => {
        logger.error(`[${requestId}] Critical error in document processing pipeline:`, error)
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
          processingConfig: {
            maxConcurrentDocuments: PROCESSING_CONFIG.maxConcurrentDocuments,
            batchSize: PROCESSING_CONFIG.batchSize,
            totalBatches: Math.ceil(createdDocuments.length / PROCESSING_CONFIG.batchSize),
          },
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
