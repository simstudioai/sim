import { and, count, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { db } from '@/db'
import { document, knowledgeBase, permissions } from '@/db/schema'

const logger = createLogger('KnowledgeBaseAPI')

const CreateKnowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  workspaceId: z.string().optional(),
  embeddingModel: z.literal('text-embedding-3-small').default('text-embedding-3-small'),
  embeddingDimension: z.literal(1536).default(1536),
  chunkingConfig: z
    .object({
      maxSize: z.number().min(100).max(4000).default(1024),
      minSize: z.number().min(50).max(2000).default(100),
      overlap: z.number().min(0).max(500).default(200),
    })
    .default({
      maxSize: 1024,
      minSize: 100,
      overlap: 200,
    })
    .refine((data) => data.minSize < data.maxSize, {
      message: 'Min chunk size must be less than max chunk size',
    }),
})

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check for workspace filtering
    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')

    // Get knowledge bases that user can access through direct ownership OR workspace permissions
    const knowledgeBasesWithCounts = await db
      .select({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        description: knowledgeBase.description,
        tokenCount: knowledgeBase.tokenCount,
        embeddingModel: knowledgeBase.embeddingModel,
        embeddingDimension: knowledgeBase.embeddingDimension,
        chunkingConfig: knowledgeBase.chunkingConfig,
        createdAt: knowledgeBase.createdAt,
        updatedAt: knowledgeBase.updatedAt,
        workspaceId: knowledgeBase.workspaceId,
        docCount: count(document.id),
      })
      .from(knowledgeBase)
      .leftJoin(
        document,
        and(eq(document.knowledgeBaseId, knowledgeBase.id), isNull(document.deletedAt))
      )
      .leftJoin(
        permissions,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, knowledgeBase.workspaceId),
          eq(permissions.userId, session.user.id)
        )
      )
      .where(
        and(
          isNull(knowledgeBase.deletedAt),
          workspaceId
            ? // When filtering by workspace
              or(
                // Knowledge bases belonging to the specified workspace (user must have workspace permissions)
                and(eq(knowledgeBase.workspaceId, workspaceId), isNotNull(permissions.userId)),
                // Fallback: User-owned knowledge bases without workspace (legacy)
                and(eq(knowledgeBase.userId, session.user.id), isNull(knowledgeBase.workspaceId))
              )
            : // When not filtering by workspace, use original logic
              or(
                // User owns the knowledge base directly
                eq(knowledgeBase.userId, session.user.id),
                // User has permissions on the knowledge base's workspace
                isNotNull(permissions.userId)
              )
        )
      )
      .groupBy(knowledgeBase.id)
      .orderBy(knowledgeBase.createdAt)

    return NextResponse.json({
      success: true,
      data: knowledgeBasesWithCounts,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching knowledge bases`, error)
    return NextResponse.json({ error: 'Failed to fetch knowledge bases' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = CreateKnowledgeBaseSchema.parse(body)

      // If creating in a workspace, check if user has write/admin permissions
      if (validatedData.workspaceId) {
        const userPermission = await getUserEntityPermissions(
          session.user.id,
          'workspace',
          validatedData.workspaceId
        )
        if (userPermission !== 'write' && userPermission !== 'admin') {
          logger.warn(
            `[${requestId}] User ${session.user.id} denied permission to create knowledge base in workspace ${validatedData.workspaceId}`
          )
          return NextResponse.json(
            { error: 'Insufficient permissions to create knowledge base in this workspace' },
            { status: 403 }
          )
        }
      }

      const id = crypto.randomUUID()
      const now = new Date()

      const newKnowledgeBase = {
        id,
        userId: session.user.id,
        workspaceId: validatedData.workspaceId || null,
        name: validatedData.name,
        description: validatedData.description || null,
        tokenCount: 0,
        embeddingModel: validatedData.embeddingModel,
        embeddingDimension: validatedData.embeddingDimension,
        chunkingConfig: validatedData.chunkingConfig || {
          maxSize: 1024,
          minSize: 100,
          overlap: 200,
        },
        docCount: 0,
        createdAt: now,
        updatedAt: now,
      }

      await db.insert(knowledgeBase).values(newKnowledgeBase)

      logger.info(`[${requestId}] Knowledge base created: ${id} for user ${session.user.id}`)

      return NextResponse.json({
        success: true,
        data: newKnowledgeBase,
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid knowledge base data`, {
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
    logger.error(`[${requestId}] Error creating knowledge base`, error)
    return NextResponse.json({ error: 'Failed to create knowledge base' }, { status: 500 })
  }
}
