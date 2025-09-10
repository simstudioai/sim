import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  deleteKnowledgeBase,
  getKnowledgeBaseById,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('KnowledgeBaseByIdAPI')

const UpdateKnowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional(),
  embeddingModel: z.literal('text-embedding-3-small').optional(),
  embeddingDimension: z.literal(1536).optional(),
  workspaceId: z.string().nullable().optional(),
  chunkingConfig: z
    .object({
      maxSize: z.number(),
      minSize: z.number(),
      overlap: z.number(),
    })
    .optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(id, session.user.id)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${id}`)
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to access unauthorized knowledge base ${id}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const knowledgeBaseData = await getKnowledgeBaseById(id)

    if (!knowledgeBaseData) {
      return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Retrieved knowledge base: ${id} for user ${session.user.id}`)

    return NextResponse.json({
      success: true,
      data: knowledgeBaseData,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching knowledge base`, error)
    return NextResponse.json({ error: 'Failed to fetch knowledge base' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseWriteAccess(id, session.user.id)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${id}`)
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to update unauthorized knowledge base ${id}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = UpdateKnowledgeBaseSchema.parse(body)

      const updatedKnowledgeBase = await updateKnowledgeBase(
        id,
        {
          name: validatedData.name,
          description: validatedData.description,
          chunkingConfig: validatedData.chunkingConfig,
        },
        requestId
      )

      logger.info(`[${requestId}] Knowledge base updated: ${id} for user ${session.user.id}`)

      return NextResponse.json({
        success: true,
        data: updatedKnowledgeBase,
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid knowledge base update data`, {
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
    logger.error(`[${requestId}] Error updating knowledge base`, error)
    return NextResponse.json({ error: 'Failed to update knowledge base' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base delete attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseWriteAccess(id, session.user.id)

    if (!accessCheck.hasAccess) {
      if ('notFound' in accessCheck && accessCheck.notFound) {
        logger.warn(`[${requestId}] Knowledge base not found: ${id}`)
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to delete unauthorized knowledge base ${id}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await deleteKnowledgeBase(id, requestId)

    logger.info(`[${requestId}] Knowledge base deleted: ${id} for user ${session.user.id}`)

    return NextResponse.json({
      success: true,
      data: { message: 'Knowledge base deleted successfully' },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting knowledge base`, error)
    return NextResponse.json({ error: 'Failed to delete knowledge base' }, { status: 500 })
  }
}
