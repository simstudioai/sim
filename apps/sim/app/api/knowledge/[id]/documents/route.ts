import crypto from 'node:crypto'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getSlotsForFieldType } from '@/lib/constants/knowledge'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserId } from '@/app/api/auth/oauth/utils'
import {
  checkKnowledgeBaseAccess,
  checkKnowledgeBaseWriteAccess,
  processDocumentAsync,
} from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { document, knowledgeBaseTagDefinitions } from '@/db/schema'

const logger = createLogger('DocumentsAPI')

const PROCESSING_CONFIG = {
  maxConcurrentDocuments: 3,
  batchSize: 5,
  delayBetweenBatches: 1000,
  delayBetweenDocuments: 500,
}

// Helper function to get the next available slot for a knowledge base and field type
async function getNextAvailableSlot(
  knowledgeBaseId: string,
  fieldType: string,
  existingBySlot?: Map<string, any>
): Promise<string | null> {
  let usedSlots: Set<string>

  if (existingBySlot) {
    // Use provided map if available (for performance in batch operations)
    // Filter by field type
    usedSlots = new Set(
      Array.from(existingBySlot.entries())
        .filter(([_, def]) => def.fieldType === fieldType)
        .map(([slot, _]) => slot)
    )
  } else {
    // Query database for existing tag definitions of the same field type
    const existingDefinitions = await db
      .select({ tagSlot: knowledgeBaseTagDefinitions.tagSlot })
      .from(knowledgeBaseTagDefinitions)
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseTagDefinitions.fieldType, fieldType)
        )
      )

    usedSlots = new Set(existingDefinitions.map((def) => def.tagSlot))
  }

  // Find the first available slot for this field type
  const availableSlots = getSlotsForFieldType(fieldType)
  for (const slot of availableSlots) {
    if (!usedSlots.has(slot)) {
      return slot
    }
  }

  return null // No available slots for this field type
}

// Helper function to process structured document tags
async function processDocumentTags(
  knowledgeBaseId: string,
  tagData: Array<{ tagName: string; fieldType: string; value: string }>,
  requestId: string
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}

  // Initialize all text tag slots to null (only text type is supported currently)
  const textSlots = getSlotsForFieldType('text')
  textSlots.forEach((slot) => {
    result[slot] = null
  })

  if (!Array.isArray(tagData) || tagData.length === 0) {
    return result
  }

  try {
    // Get existing tag definitions
    const existingDefinitions = await db
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    const existingByName = new Map(existingDefinitions.map((def) => [def.displayName, def]))
    const existingBySlot = new Map(existingDefinitions.map((def) => [def.tagSlot, def]))

    // Process each tag
    for (const tag of tagData) {
      if (!tag.tagName?.trim() || !tag.value?.trim()) continue

      const tagName = tag.tagName.trim()
      const fieldType = tag.fieldType
      const value = tag.value.trim()

      let targetSlot: string | null = null

      // Check if tag definition already exists
      const existingDef = existingByName.get(tagName)
      if (existingDef) {
        targetSlot = existingDef.tagSlot
      } else {
        // Find next available slot using the helper function
        targetSlot = await getNextAvailableSlot(knowledgeBaseId, fieldType, existingBySlot)

        // Create new tag definition if we have a slot
        if (targetSlot) {
          const newDefinition = {
            id: crypto.randomUUID(),
            knowledgeBaseId,
            tagSlot: targetSlot as any,
            displayName: tagName,
            fieldType,
            createdAt: new Date(),
            updatedAt: new Date(),
          }

          await db.insert(knowledgeBaseTagDefinitions).values(newDefinition)
          existingBySlot.set(targetSlot as any, newDefinition)

          logger.info(`[${requestId}] Created tag definition: ${tagName} -> ${targetSlot}`)
        }
      }

      // Assign value to the slot
      if (targetSlot) {
        result[targetSlot] = value
      }
    }

    return result
  } catch (error) {
    logger.error(`[${requestId}] Error processing document tags:`, error)
    return result
  }
}

async function processDocumentsWithConcurrencyControl(
  createdDocuments: Array<{
    documentId: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  }>,
  knowledgeBaseId: string,
  processingOptions: {
    chunkSize: number
    minCharactersPerChunk: number
    recipe: string
    lang: string
    chunkOverlap: number
  },
  requestId: string
): Promise<void> {
  const totalDocuments = createdDocuments.length
  const batches = []

  for (let i = 0; i < totalDocuments; i += PROCESSING_CONFIG.batchSize) {
    batches.push(createdDocuments.slice(i, i + PROCESSING_CONFIG.batchSize))
  }

  logger.info(`[${requestId}] Processing ${totalDocuments} documents in ${batches.length} batches`)

  for (const [batchIndex, batch] of batches.entries()) {
    logger.info(
      `[${requestId}] Starting batch ${batchIndex + 1}/${batches.length} with ${batch.length} documents`
    )

    await processBatchWithConcurrency(batch, knowledgeBaseId, processingOptions, requestId)

    if (batchIndex < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, PROCESSING_CONFIG.delayBetweenBatches))
    }
  }

  logger.info(`[${requestId}] Completed processing initiation for all ${totalDocuments} documents`)
}

async function processBatchWithConcurrency(
  batch: Array<{
    documentId: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  }>,
  knowledgeBaseId: string,
  processingOptions: {
    chunkSize: number
    minCharactersPerChunk: number
    recipe: string
    lang: string
    chunkOverlap: number
  },
  requestId: string
): Promise<void> {
  const semaphore = new Array(PROCESSING_CONFIG.maxConcurrentDocuments).fill(0)
  const processingPromises = batch.map(async (doc, index) => {
    if (index > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, index * PROCESSING_CONFIG.delayBetweenDocuments)
      )
    }

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
        },
        processingOptions
      )

      logger.info(`[${requestId}] Successfully initiated processing for document: ${doc.filename}`)
    } catch (error: unknown) {
      logger.error(`[${requestId}] Failed to process document: ${doc.filename}`, {
        documentId: doc.documentId,
        filename: doc.filename,
        error: error instanceof Error ? error.message : 'Unknown error',
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

const CreateDocumentSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  fileUrl: z.string().url('File URL must be valid'),
  fileSize: z.number().min(1, 'File size must be greater than 0'),
  mimeType: z.string().min(1, 'MIME type is required'),
  // Document tags for filtering (legacy format)
  tag1: z.string().optional(),
  tag2: z.string().optional(),
  tag3: z.string().optional(),
  tag4: z.string().optional(),
  tag5: z.string().optional(),
  tag6: z.string().optional(),
  tag7: z.string().optional(),
  // Structured tag data (new format)
  documentTagsData: z.string().optional(),
})

const BulkCreateDocumentsSchema = z.object({
  documents: z.array(CreateDocumentSchema),
  processingOptions: z.object({
    chunkSize: z.number().min(100).max(4000),
    minCharactersPerChunk: z.number().min(50).max(2000),
    recipe: z.string(),
    lang: z.string(),
    chunkOverlap: z.number().min(0).max(500),
  }),
  bulk: z.literal(true),
})

const BulkUpdateDocumentsSchema = z.object({
  operation: z.enum(['enable', 'disable', 'delete']),
  documentIds: z
    .array(z.string())
    .min(1, 'At least one document ID is required')
    .max(100, 'Cannot operate on more than 100 documents at once'),
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
    const search = url.searchParams.get('search')
    const limit = Number.parseInt(url.searchParams.get('limit') || '50')
    const offset = Number.parseInt(url.searchParams.get('offset') || '0')

    // Build where conditions
    const whereConditions = [
      eq(document.knowledgeBaseId, knowledgeBaseId),
      isNull(document.deletedAt),
    ]

    // Filter out disabled documents unless specifically requested
    if (!includeDisabled) {
      whereConditions.push(eq(document.enabled, true))
    }

    // Add search condition if provided
    if (search) {
      whereConditions.push(
        // Search in filename
        sql`LOWER(${document.filename}) LIKE LOWER(${`%${search}%`})`
      )
    }

    // Get total count for pagination
    const totalResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(document)
      .where(and(...whereConditions))

    const total = totalResult[0]?.count || 0
    const hasMore = offset + limit < total

    const documents = await db
      .select({
        id: document.id,
        filename: document.filename,
        fileUrl: document.fileUrl,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        chunkCount: document.chunkCount,
        tokenCount: document.tokenCount,
        characterCount: document.characterCount,
        processingStatus: document.processingStatus,
        processingStartedAt: document.processingStartedAt,
        processingCompletedAt: document.processingCompletedAt,
        processingError: document.processingError,
        enabled: document.enabled,
        uploadedAt: document.uploadedAt,
        // Include tags in response
        tag1: document.tag1,
        tag2: document.tag2,
        tag3: document.tag3,
        tag4: document.tag4,
        tag5: document.tag5,
        tag6: document.tag6,
        tag7: document.tag7,
      })
      .from(document)
      .where(and(...whereConditions))
      .orderBy(desc(document.uploadedAt))
      .limit(limit)
      .offset(offset)

    logger.info(
      `[${requestId}] Retrieved ${documents.length} documents (${offset}-${offset + documents.length} of ${total}) for knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: {
        documents,
        pagination: {
          total,
          limit,
          offset,
          hasMore,
        },
      },
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
    const body = await req.json()
    const { workflowId } = body

    logger.info(`[${requestId}] Knowledge base document creation request`, {
      knowledgeBaseId,
      workflowId,
      hasWorkflowId: !!workflowId,
      bodyKeys: Object.keys(body),
    })

    const userId = await getUserId(requestId, workflowId)

    if (!userId) {
      const errorMessage = workflowId ? 'Workflow not found' : 'Unauthorized'
      const statusCode = workflowId ? 404 : 401
      logger.warn(`[${requestId}] Authentication failed: ${errorMessage}`, {
        workflowId,
        hasWorkflowId: !!workflowId,
      })
      return NextResponse.json({ error: errorMessage }, { status: statusCode })
    }

    const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, userId)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted to create document in unauthorized knowledge base ${knowledgeBaseId}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if this is a bulk operation
    if (body.bulk === true) {
      // Handle bulk processing (replaces process-documents endpoint)
      try {
        const validatedData = BulkCreateDocumentsSchema.parse(body)

        const createdDocuments = await db.transaction(async (tx) => {
          const documentPromises = validatedData.documents.map(async (docData) => {
            const documentId = crypto.randomUUID()
            const now = new Date()

            // Process documentTagsData if provided (for knowledge base block)
            let processedTags: Record<string, string | null> = {
              tag1: null,
              tag2: null,
              tag3: null,
              tag4: null,
              tag5: null,
              tag6: null,
              tag7: null,
            }

            if (docData.documentTagsData) {
              try {
                const tagData = JSON.parse(docData.documentTagsData)
                if (Array.isArray(tagData)) {
                  processedTags = await processDocumentTags(knowledgeBaseId, tagData, requestId)
                }
              } catch (error) {
                logger.warn(
                  `[${requestId}] Failed to parse documentTagsData for bulk document:`,
                  error
                )
              }
            }

            const newDocument = {
              id: documentId,
              knowledgeBaseId,
              filename: docData.filename,
              fileUrl: docData.fileUrl,
              fileSize: docData.fileSize,
              mimeType: docData.mimeType,
              chunkCount: 0,
              tokenCount: 0,
              characterCount: 0,
              processingStatus: 'pending' as const,
              enabled: true,
              uploadedAt: now,
              // Use processed tags if available, otherwise fall back to individual tag fields
              tag1: processedTags.tag1 || docData.tag1 || null,
              tag2: processedTags.tag2 || docData.tag2 || null,
              tag3: processedTags.tag3 || docData.tag3 || null,
              tag4: processedTags.tag4 || docData.tag4 || null,
              tag5: processedTags.tag5 || docData.tag5 || null,
              tag6: processedTags.tag6 || docData.tag6 || null,
              tag7: processedTags.tag7 || docData.tag7 || null,
            }

            await tx.insert(document).values(newDocument)
            logger.info(
              `[${requestId}] Document record created: ${documentId} for file: ${docData.filename}`
            )
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
          logger.warn(`[${requestId}] Invalid bulk processing request data`, {
            errors: validationError.errors,
          })
          return NextResponse.json(
            { error: 'Invalid request data', details: validationError.errors },
            { status: 400 }
          )
        }
        throw validationError
      }
    } else {
      // Handle single document creation
      try {
        const validatedData = CreateDocumentSchema.parse(body)

        const documentId = crypto.randomUUID()
        const now = new Date()

        // Process structured tag data if provided
        let processedTags: Record<string, string | null> = {
          tag1: validatedData.tag1 || null,
          tag2: validatedData.tag2 || null,
          tag3: validatedData.tag3 || null,
          tag4: validatedData.tag4 || null,
          tag5: validatedData.tag5 || null,
          tag6: validatedData.tag6 || null,
          tag7: validatedData.tag7 || null,
        }

        if (validatedData.documentTagsData) {
          try {
            const tagData = JSON.parse(validatedData.documentTagsData)
            if (Array.isArray(tagData)) {
              // Process structured tag data and create tag definitions
              processedTags = await processDocumentTags(knowledgeBaseId, tagData, requestId)
            }
          } catch (error) {
            logger.warn(`[${requestId}] Failed to parse documentTagsData:`, error)
          }
        }

        const newDocument = {
          id: documentId,
          knowledgeBaseId,
          filename: validatedData.filename,
          fileUrl: validatedData.fileUrl,
          fileSize: validatedData.fileSize,
          mimeType: validatedData.mimeType,
          chunkCount: 0,
          tokenCount: 0,
          characterCount: 0,
          enabled: true,
          uploadedAt: now,
          ...processedTags,
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
    }
  } catch (error) {
    logger.error(`[${requestId}] Error creating document`, error)
    return NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized bulk document operation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, session.user.id)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to perform bulk operation on unauthorized knowledge base ${knowledgeBaseId}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = BulkUpdateDocumentsSchema.parse(body)
      const { operation, documentIds } = validatedData

      logger.info(
        `[${requestId}] Starting bulk ${operation} operation on ${documentIds.length} documents in knowledge base ${knowledgeBaseId}`
      )

      // Verify all documents belong to this knowledge base and user has access
      const documentsToUpdate = await db
        .select({
          id: document.id,
          enabled: document.enabled,
        })
        .from(document)
        .where(
          and(
            eq(document.knowledgeBaseId, knowledgeBaseId),
            inArray(document.id, documentIds),
            isNull(document.deletedAt)
          )
        )

      if (documentsToUpdate.length === 0) {
        return NextResponse.json({ error: 'No valid documents found to update' }, { status: 404 })
      }

      if (documentsToUpdate.length !== documentIds.length) {
        logger.warn(
          `[${requestId}] Some documents not found or don't belong to knowledge base. Requested: ${documentIds.length}, Found: ${documentsToUpdate.length}`
        )
      }

      // Perform the bulk operation
      let updateResult: Array<{ id: string; enabled?: boolean; deletedAt?: Date | null }>
      let successCount: number

      if (operation === 'delete') {
        // Handle bulk soft delete
        updateResult = await db
          .update(document)
          .set({
            deletedAt: new Date(),
          })
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeBaseId),
              inArray(document.id, documentIds),
              isNull(document.deletedAt)
            )
          )
          .returning({ id: document.id, deletedAt: document.deletedAt })

        successCount = updateResult.length
      } else {
        // Handle bulk enable/disable
        const enabled = operation === 'enable'

        updateResult = await db
          .update(document)
          .set({
            enabled,
          })
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeBaseId),
              inArray(document.id, documentIds),
              isNull(document.deletedAt)
            )
          )
          .returning({ id: document.id, enabled: document.enabled })

        successCount = updateResult.length
      }

      logger.info(
        `[${requestId}] Bulk ${operation} operation completed: ${successCount} documents updated in knowledge base ${knowledgeBaseId}`
      )

      return NextResponse.json({
        success: true,
        data: {
          operation,
          successCount,
          updatedDocuments: updateResult,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid bulk operation data`, {
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
    logger.error(`[${requestId}] Error in bulk document operation`, error)
    return NextResponse.json({ error: 'Failed to perform bulk operation' }, { status: 500 })
  }
}
