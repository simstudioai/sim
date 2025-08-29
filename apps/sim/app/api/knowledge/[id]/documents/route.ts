import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  bulkDocumentOperation,
  createDocumentRecords,
  createSingleDocument,
  getDocuments,
  getProcessingConfig,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('DocumentsAPI')

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
    minCharactersPerChunk: z.number().min(1).max(2000),
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
  const requestId = randomUUID().slice(0, 8)
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
    const search = url.searchParams.get('search') || undefined
    const limit = Number.parseInt(url.searchParams.get('limit') || '50')
    const offset = Number.parseInt(url.searchParams.get('offset') || '0')
    const sortByParam = url.searchParams.get('sortBy')
    const sortOrderParam = url.searchParams.get('sortOrder')

    // Validate sort parameters
    const validSortFields: DocumentSortField[] = [
      'filename',
      'fileSize',
      'tokenCount',
      'chunkCount',
      'uploadedAt',
      'processingStatus',
    ]
    const validSortOrders: SortOrder[] = ['asc', 'desc']

    const sortBy =
      sortByParam && validSortFields.includes(sortByParam as DocumentSortField)
        ? (sortByParam as DocumentSortField)
        : undefined
    const sortOrder =
      sortOrderParam && validSortOrders.includes(sortOrderParam as SortOrder)
        ? (sortOrderParam as SortOrder)
        : undefined

    const result = await getDocuments(
      knowledgeBaseId,
      {
        includeDisabled,
        search,
        limit,
        offset,
        ...(sortBy && { sortBy }),
        ...(sortOrder && { sortOrder }),
      },
      requestId
    )

    return NextResponse.json({
      success: true,
      data: {
        documents: result.documents,
        pagination: result.pagination,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching documents`, error)
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID().slice(0, 8)
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

    if (body.bulk === true) {
      try {
        const validatedData = BulkCreateDocumentsSchema.parse(body)

        const createdDocuments = await createDocumentRecords(
          validatedData.documents,
          knowledgeBaseId,
          requestId
        )

        logger.info(
          `[${requestId}] Starting controlled async processing of ${createdDocuments.length} documents`
        )

        processDocumentsWithQueue(
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
              maxConcurrentDocuments: getProcessingConfig().maxConcurrentDocuments,
              batchSize: getProcessingConfig().batchSize,
              totalBatches: Math.ceil(createdDocuments.length / getProcessingConfig().batchSize),
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

        const newDocument = await createSingleDocument(validatedData, knowledgeBaseId, requestId)

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
  const requestId = randomUUID().slice(0, 8)
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

      try {
        const result = await bulkDocumentOperation(
          knowledgeBaseId,
          operation,
          documentIds,
          requestId
        )

        return NextResponse.json({
          success: true,
          data: {
            operation,
            successCount: result.successCount,
            updatedDocuments: result.updatedDocuments,
          },
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'No valid documents found to update') {
          return NextResponse.json({ error: 'No valid documents found to update' }, { status: 404 })
        }
        throw error
      }
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
