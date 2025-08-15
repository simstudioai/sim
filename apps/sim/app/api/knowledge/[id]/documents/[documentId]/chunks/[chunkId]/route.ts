import { createHash, randomUUID } from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { checkChunkAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { document, embedding } from '@/db/schema'

const logger = createLogger('ChunkByIdAPI')

const UpdateChunkSchema = z.object({
  content: z.string().min(1, 'Content is required').optional(),
  enabled: z.boolean().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string; chunkId: string }> }
) {
  const requestId = randomUUID().slice(0, 8)
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

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
        )
        return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
      }
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
  const requestId = randomUUID().slice(0, 8)
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

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
        )
        return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized chunk update: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = UpdateChunkSchema.parse(body)

      const updateData: Partial<{
        content: string
        contentLength: number
        tokenCount: number
        chunkHash: string
        enabled: boolean
        updatedAt: Date
      }> = {}

      if (validatedData.content) {
        updateData.content = validatedData.content
        updateData.contentLength = validatedData.content.length
        // Update token count estimation (rough approximation: 4 chars per token)
        updateData.tokenCount = Math.ceil(validatedData.content.length / 4)
        updateData.chunkHash = createHash('sha256').update(validatedData.content).digest('hex')
      }

      if (validatedData.enabled !== undefined) updateData.enabled = validatedData.enabled

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
  const requestId = randomUUID().slice(0, 8)
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

    if (!accessCheck.hasAccess) {
      if (accessCheck.notFound) {
        logger.warn(
          `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
        )
        return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted unauthorized chunk deletion: ${accessCheck.reason}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Use transaction to atomically delete chunk and update document statistics
    await db.transaction(async (tx) => {
      // Get chunk data before deletion for statistics update
      const chunkToDelete = await tx
        .select({
          tokenCount: embedding.tokenCount,
          contentLength: embedding.contentLength,
        })
        .from(embedding)
        .where(eq(embedding.id, chunkId))
        .limit(1)

      if (chunkToDelete.length === 0) {
        throw new Error('Chunk not found')
      }

      const chunk = chunkToDelete[0]

      // Delete the chunk
      await tx.delete(embedding).where(eq(embedding.id, chunkId))

      // Update document statistics
      await tx
        .update(document)
        .set({
          chunkCount: sql`${document.chunkCount} - 1`,
          tokenCount: sql`${document.tokenCount} - ${chunk.tokenCount}`,
          characterCount: sql`${document.characterCount} - ${chunk.contentLength}`,
        })
        .where(eq(document.id, documentId))
    })

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
