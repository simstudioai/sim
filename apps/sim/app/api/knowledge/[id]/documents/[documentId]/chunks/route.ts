import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { batchChunkOperation, createChunk, queryChunks } from '@/lib/knowledge/chunks/service'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { checkDocumentAccess, checkDocumentWriteAccess } from '@/app/api/knowledge/utils'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('DocumentChunksAPI')

const GetChunksQuerySchema = z.object({
  search: z.string().optional(),
  enabled: z.enum(['true', 'false', 'all']).optional().default('all'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
})

const CreateChunkSchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000, 'Content too long'),
  enabled: z.boolean().optional().default(true),
})

const BatchOperationSchema = z.object({
  operation: z.enum(['enable', 'disable', 'delete']),
  chunkIds: z
    .array(z.string())
    .min(1, 'At least one chunk ID is required')
    .max(100, 'Cannot operate on more than 100 chunks at once'),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized chunks access attempt`)
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
        `[${requestId}] User ${session.user.id} attempted unauthorized chunks access: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const doc = accessCheck.document
    if (!doc) {
      logger.warn(
        `[${requestId}] Document data not available: KB=${knowledgeBaseId}, Doc=${documentId}`
      )
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (doc.processingStatus !== 'completed') {
      logger.warn(
        `[${requestId}] Document ${documentId} is not ready for chunk access (status: ${doc.processingStatus})`
      )
      return NextResponse.json(
        {
          error: 'Document is not ready for access',
          details: `Document status: ${doc.processingStatus}`,
          retryAfter: doc.processingStatus === 'processing' ? 5 : null,
        },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(req.url)
    const queryParams = GetChunksQuerySchema.parse({
      search: searchParams.get('search') || undefined,
      enabled: searchParams.get('enabled') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
    })

    const result = await queryChunks(documentId, queryParams, requestId)

    return NextResponse.json({
      success: true,
      data: result.chunks,
      pagination: result.pagination,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching chunks`, error)
    return NextResponse.json({ error: 'Failed to fetch chunks' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const body = await req.json()
    const { workflowId, ...searchParams } = body

    const userId = await getUserId(requestId, workflowId)

    if (!userId) {
      const errorMessage = workflowId ? 'Workflow not found' : 'Unauthorized'
      const statusCode = workflowId ? 404 : 401
      logger.warn(`[${requestId}] Authentication failed: ${errorMessage}`)
      return NextResponse.json({ error: errorMessage }, { status: statusCode })
    }

    const accessCheck = await checkDocumentWriteAccess(knowledgeBaseId, documentId, userId)

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
        )
        return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${userId} attempted unauthorized chunk creation: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const doc = accessCheck.document
    if (!doc) {
      logger.warn(
        `[${requestId}] Document data not available: KB=${knowledgeBaseId}, Doc=${documentId}`
      )
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Allow manual chunk creation even if document is not fully processed
    // but it should exist and not be in failed state
    if (doc.processingStatus === 'failed') {
      logger.warn(`[${requestId}] Document ${documentId} is in failed state, cannot add chunks`)
      return NextResponse.json({ error: 'Cannot add chunks to failed document' }, { status: 400 })
    }

    try {
      const validatedData = CreateChunkSchema.parse(searchParams)

      const docTags = {
        tag1: doc.tag1 ?? null,
        tag2: doc.tag2 ?? null,
        tag3: doc.tag3 ?? null,
        tag4: doc.tag4 ?? null,
        tag5: doc.tag5 ?? null,
        tag6: doc.tag6 ?? null,
        tag7: doc.tag7 ?? null,
      }

      const newChunk = await createChunk(
        knowledgeBaseId,
        documentId,
        docTags,
        validatedData,
        requestId
      )

      let cost = null
      try {
        cost = calculateCost('text-embedding-3-small', newChunk.tokenCount, 0, false)
      } catch (error) {
        logger.warn(`[${requestId}] Failed to calculate cost for chunk upload`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        // Continue without cost information rather than failing the upload
      }

      return NextResponse.json({
        success: true,
        data: {
          ...newChunk,
          documentId,
          documentName: doc.filename,
          ...(cost
            ? {
                cost: {
                  input: cost.input,
                  output: cost.output,
                  total: cost.total,
                  tokens: {
                    prompt: newChunk.tokenCount,
                    completion: 0,
                    total: newChunk.tokenCount,
                  },
                  model: 'text-embedding-3-small',
                  pricing: cost.pricing,
                },
              }
            : {}),
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid chunk creation data`, {
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
    logger.error(`[${requestId}] Error creating chunk`, error)
    return NextResponse.json({ error: 'Failed to create chunk' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const requestId = generateRequestId()
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized batch chunk operation attempt`)
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
        `[${requestId}] User ${session.user.id} attempted unauthorized batch chunk operation: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = BatchOperationSchema.parse(body)
      const { operation, chunkIds } = validatedData

      const result = await batchChunkOperation(documentId, operation, chunkIds, requestId)

      return NextResponse.json({
        success: true,
        data: {
          operation,
          successCount: result.processed,
          errorCount: result.errors.length,
          processed: result.processed,
          errors: result.errors,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid batch operation data`, {
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
    logger.error(`[${requestId}] Error in batch chunk operation`, error)
    return NextResponse.json({ error: 'Failed to perform batch operation' }, { status: 500 })
  }
}
