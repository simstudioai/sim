import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document, embedding, knowledgeBase } from '@/db/schema'

const logger = createLogger('ChunkByIdAPI')

// Schema for chunk updates
const UpdateChunkSchema = z.object({
  content: z.string().min(1, 'Content is required').optional(),
  enabled: z.boolean().optional(),
  searchRank: z.number().min(0).optional(),
  qualityScore: z.number().min(0).max(1).optional(),
})

async function checkChunkAccess(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  userId: string
) {
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

  // Check if document exists and belongs to the knowledge base
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

  // Check if chunk exists and belongs to the document
  const chunk = await db
    .select()
    .from(embedding)
    .where(and(eq(embedding.id, chunkId), eq(embedding.documentId, documentId)))
    .limit(1)

  if (chunk.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Chunk not found' }
  }

  return { hasAccess: true, chunk: chunk[0], document: doc[0], knowledgeBase: kbData }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string; chunkId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId, chunkId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized chunk access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkChunkAccess(
      knowledgeBaseId,
      documentId,
      chunkId,
      session.user.id
    )

    if (accessCheck.notFound) {
      logger.warn(
        `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
      )
      return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
    }

    if (!accessCheck.hasAccess) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized chunk access: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info(
      `[${requestId}] Retrieved chunk: ${chunkId} from document ${documentId} in knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: accessCheck.chunk,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching chunk`, error)
    return NextResponse.json({ error: 'Failed to fetch chunk' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string; chunkId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId, chunkId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized chunk update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkChunkAccess(
      knowledgeBaseId,
      documentId,
      chunkId,
      session.user.id
    )

    if (accessCheck.notFound) {
      logger.warn(
        `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
      )
      return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
    }

    if (!accessCheck.hasAccess) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized chunk update: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = UpdateChunkSchema.parse(body)

      const updateData: any = {
        updatedAt: new Date(),
      }

      if (validatedData.content !== undefined) {
        updateData.content = validatedData.content
        updateData.contentLength = validatedData.content.length
        // Update token count estimation (rough approximation: 4 chars per token)
        updateData.tokenCount = Math.ceil(validatedData.content.length / 4)
      }
      if (validatedData.enabled !== undefined) updateData.enabled = validatedData.enabled
      if (validatedData.searchRank !== undefined)
        updateData.searchRank = validatedData.searchRank.toString()
      if (validatedData.qualityScore !== undefined)
        updateData.qualityScore = validatedData.qualityScore.toString()

      await db.update(embedding).set(updateData).where(eq(embedding.id, chunkId))

      // Fetch the updated chunk
      const updatedChunk = await db
        .select()
        .from(embedding)
        .where(eq(embedding.id, chunkId))
        .limit(1)

      logger.info(
        `[${requestId}] Chunk updated: ${chunkId} in document ${documentId} in knowledge base ${knowledgeBaseId}`
      )

      return NextResponse.json({
        success: true,
        data: updatedChunk[0],
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid chunk update data`, {
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
    logger.error(`[${requestId}] Error updating chunk`, error)
    return NextResponse.json({ error: 'Failed to update chunk' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string; chunkId: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: knowledgeBaseId, documentId, chunkId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized chunk delete attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkChunkAccess(
      knowledgeBaseId,
      documentId,
      chunkId,
      session.user.id
    )

    if (accessCheck.notFound) {
      logger.warn(
        `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
      )
      return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
    }

    if (!accessCheck.hasAccess) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized chunk deletion: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Delete the chunk
    await db.delete(embedding).where(eq(embedding.id, chunkId))

    logger.info(
      `[${requestId}] Chunk deleted: ${chunkId} from document ${documentId} in knowledge base ${knowledgeBaseId}`
    )

    return NextResponse.json({
      success: true,
      data: { message: 'Chunk deleted successfully' },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting chunk`, error)
    return NextResponse.json({ error: 'Failed to delete chunk' }, { status: 500 })
  }
}
