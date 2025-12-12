import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { deleteChunk, updateChunk } from '@/lib/knowledge/chunks/service'
import { createLogger } from '@/lib/logs/console/logger'
import { checkChunkAccess } from '@/app/api/knowledge/utils'

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

      const updatedChunk = await updateChunk(chunkId, validatedData, requestId)

      logger.info(
        `[${requestId}] Chunk updated: ${chunkId} in document ${documentId} in knowledge base ${knowledgeBaseId}`
      )

      return NextResponse.json({
        success: true,
        data: updatedChunk,
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

    await deleteChunk(chunkId, documentId, requestId)

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
