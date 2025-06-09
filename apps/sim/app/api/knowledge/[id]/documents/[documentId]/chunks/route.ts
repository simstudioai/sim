import crypto from 'crypto'
import { and, asc, eq, ilike, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document, embedding } from '@/db/schema'
import { checkDocumentAccess, generateEmbeddings } from '../../../../utils'

const logger = createLogger('DocumentChunksAPI')

// Schema for query parameters
const GetChunksQuerySchema = z.object({
  search: z.string().optional(),
  enabled: z.enum(['true', 'false', 'all']).optional().default('all'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
})

// Schema for creating manual chunks
const CreateChunkSchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000, 'Content too long'),
  enabled: z.boolean().optional().default(true),
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

    // Check if document processing is completed
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

    // Parse query parameters
    const { searchParams } = new URL(req.url)
    const queryParams = GetChunksQuerySchema.parse({
      search: searchParams.get('search') || undefined,
      enabled: searchParams.get('enabled') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
    })

    // Build query conditions
    const conditions = [eq(embedding.documentId, documentId)]

    // Add enabled filter
    if (queryParams.enabled === 'true') {
      conditions.push(eq(embedding.enabled, true))
    } else if (queryParams.enabled === 'false') {
      conditions.push(eq(embedding.enabled, false))
    }

    // Add search filter
    if (queryParams.search) {
      conditions.push(ilike(embedding.content, `%${queryParams.search}%`))
    }

    // Fetch chunks
    const chunks = await db
      .select({
        id: embedding.id,
        chunkIndex: embedding.chunkIndex,
        content: embedding.content,
        contentLength: embedding.contentLength,
        tokenCount: embedding.tokenCount,
        enabled: embedding.enabled,
        startOffset: embedding.startOffset,
        endOffset: embedding.endOffset,
        overlapTokens: embedding.overlapTokens,
        metadata: embedding.metadata,
        searchRank: embedding.searchRank,
        qualityScore: embedding.qualityScore,
        createdAt: embedding.createdAt,
        updatedAt: embedding.updatedAt,
      })
      .from(embedding)
      .where(and(...conditions))
      .orderBy(asc(embedding.chunkIndex))
      .limit(queryParams.limit)
      .offset(queryParams.offset)

    // Get total count for pagination
    const totalCount = await db
      .select({ count: sql`count(*)` })
      .from(embedding)
      .where(and(...conditions))

    logger.info(
      `[${requestId}] Retrieved ${chunks.length} chunks for document ${documentId} in knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: chunks,
      pagination: {
        total: Number(totalCount[0]?.count || 0),
        limit: queryParams.limit,
        offset: queryParams.offset,
        hasMore: chunks.length === queryParams.limit,
      },
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
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized chunk creation attempt`)
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
        `[${requestId}] User ${session.user.id} attempted unauthorized chunk creation: ${accessCheck.reason}`
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

    const body = await req.json()

    try {
      const validatedData = CreateChunkSchema.parse(body)

      // Generate embedding for the content first (outside transaction for performance)
      logger.info(`[${requestId}] Generating embedding for manual chunk`)
      const embeddings = await generateEmbeddings([validatedData.content])

      const chunkId = crypto.randomUUID()
      const now = new Date()

      // Use transaction to atomically get next index and insert chunk
      const newChunk = await db.transaction(async (tx) => {
        // Get the next chunk index atomically within the transaction
        const lastChunk = await tx
          .select({ chunkIndex: embedding.chunkIndex })
          .from(embedding)
          .where(eq(embedding.documentId, documentId))
          .orderBy(sql`${embedding.chunkIndex} DESC`)
          .limit(1)

        const nextChunkIndex = lastChunk.length > 0 ? lastChunk[0].chunkIndex + 1 : 0

        const chunkData = {
          id: chunkId,
          knowledgeBaseId,
          documentId,
          chunkIndex: nextChunkIndex,
          chunkHash: crypto.createHash('sha256').update(validatedData.content).digest('hex'),
          content: validatedData.content,
          contentLength: validatedData.content.length,
          tokenCount: Math.ceil(validatedData.content.length / 4), // Rough approximation
          embedding: embeddings[0],
          embeddingModel: 'text-embedding-3-small',
          startOffset: 0, // Manual chunks don't have document offsets
          endOffset: validatedData.content.length,
          overlapTokens: 0,
          metadata: { manual: true }, // Mark as manually created
          searchRank: '1.0',
          accessCount: 0,
          lastAccessedAt: null,
          qualityScore: null,
          enabled: validatedData.enabled,
          createdAt: now,
          updatedAt: now,
        }

        // Insert the new chunk
        await tx.insert(embedding).values(chunkData)

        // Update document statistics
        await tx
          .update(document)
          .set({
            chunkCount: sql`${document.chunkCount} + 1`,
            tokenCount: sql`${document.tokenCount} + ${chunkData.tokenCount}`,
            characterCount: sql`${document.characterCount} + ${chunkData.contentLength}`,
          })
          .where(eq(document.id, documentId))

        return chunkData
      })

      logger.info(`[${requestId}] Manual chunk created: ${chunkId} in document ${documentId}`)

      return NextResponse.json({
        success: true,
        data: newChunk,
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
