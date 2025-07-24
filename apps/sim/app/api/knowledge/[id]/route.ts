import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { knowledgeBase } from '@/db/schema'

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
  const requestId = crypto.randomUUID().slice(0, 8)
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

    const knowledgeBases = await db
      .select()
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, id), isNull(knowledgeBase.deletedAt)))
      .limit(1)

    if (knowledgeBases.length === 0) {
      return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Retrieved knowledge base: ${id} for user ${session.user.id}`)

    return NextResponse.json({
      success: true,
      data: knowledgeBases[0],
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching knowledge base`, error)
    return NextResponse.json({ error: 'Failed to fetch knowledge base' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
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

      const updateData: any = {
        updatedAt: new Date(),
      }

      if (validatedData.name !== undefined) updateData.name = validatedData.name
      if (validatedData.description !== undefined)
        updateData.description = validatedData.description
      if (validatedData.workspaceId !== undefined)
        updateData.workspaceId = validatedData.workspaceId

      // Handle embedding model and dimension together to ensure consistency
      if (
        validatedData.embeddingModel !== undefined ||
        validatedData.embeddingDimension !== undefined
      ) {
        updateData.embeddingModel = 'text-embedding-3-small'
        updateData.embeddingDimension = 1536
      }

      if (validatedData.chunkingConfig !== undefined)
        updateData.chunkingConfig = validatedData.chunkingConfig

      await db.update(knowledgeBase).set(updateData).where(eq(knowledgeBase.id, id))

      // Fetch the updated knowledge base
      const updatedKnowledgeBase = await db
        .select()
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, id))
        .limit(1)

      logger.info(`[${requestId}] Knowledge base updated: ${id} for user ${session.user.id}`)

      return NextResponse.json({
        success: true,
        data: updatedKnowledgeBase[0],
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
  const requestId = crypto.randomUUID().slice(0, 8)
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

    // Soft delete by setting deletedAt timestamp
    await db
      .update(knowledgeBase)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeBase.id, id))

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
