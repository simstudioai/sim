import { and, asc, eq, ilike, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { embedding } from '@/db/schema'
import { checkDocumentAccess } from '../../../../utils'

const logger = createLogger('DocumentChunksAPI')

// Schema for query parameters
const GetChunksQuerySchema = z.object({
  search: z.string().optional(),
  enabled: z.enum(['true', 'false', 'all']).optional().default('all'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
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
