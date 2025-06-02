import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document, embedding, knowledgeBase } from '@/db/schema'

const logger = createLogger('DocumentChunksAPI')

// Schema for query parameters
const GetChunksQuerySchema = z.object({
  search: z.string().optional(),
  enabled: z.enum(['true', 'false', 'all']).optional().default('all'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
})

async function checkDocumentAccess(knowledgeBaseId: string, documentId: string, userId: string) {
  // First check knowledge base access
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Knowledge base not found' }
  }

  const kbData = kb[0]

  // Check if user owns the knowledge base
  if (kbData.userId !== userId) {
    return { hasAccess: false, reason: 'Unauthorized knowledge base access' }
  }

  // Now check if document exists and belongs to the knowledge base
  const doc = await db
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        isNull(document.deletedAt)
      )
    )
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  return { hasAccess: true, document: doc[0], knowledgeBase: kbData }
}

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

    if (accessCheck.notFound) {
      logger.warn(`[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`)
      return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
    }

    if (!accessCheck.hasAccess) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized chunks access: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
