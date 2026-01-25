import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { createKnowledgeBase, getKnowledgeBases } from '@/lib/knowledge/service'

const logger = createLogger('KnowledgeBaseAPI')

/**
 * Schema for creating a knowledge base
 *
 * Chunking config units:
 * - maxSize: tokens (1 token ≈ 4 characters)
 * - minSize: characters
 * - overlap: tokens (1 token ≈ 4 characters)
 */
const CreateKnowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  embeddingModel: z.literal('text-embedding-3-small').default('text-embedding-3-small'),
  embeddingDimension: z.literal(1536).default(1536),
  chunkingConfig: z
    .object({
      /** Maximum chunk size in tokens (1 token ≈ 4 characters) */
      maxSize: z.number().min(100).max(4000).default(1024),
      /** Minimum chunk size in characters */
      minSize: z.number().min(1).max(2000).default(100),
      /** Overlap between chunks in tokens (1 token ≈ 4 characters) */
      overlap: z.number().min(0).max(500).default(200),
    })
    .default({
      maxSize: 1024,
      minSize: 100,
      overlap: 200,
    })
    .refine(
      (data) => {
        // Convert maxSize from tokens to characters for comparison (1 token ≈ 4 chars)
        const maxSizeInChars = data.maxSize * 4
        return data.minSize < maxSizeInChars
      },
      {
        message: 'Min chunk size (characters) must be less than max chunk size (tokens × 4)',
      }
    ),
})

export async function GET(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')

    const knowledgeBasesWithCounts = await getKnowledgeBases(session.user.id, workspaceId)

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
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const validatedData = CreateKnowledgeBaseSchema.parse(body)

      const createData = {
        ...validatedData,
        userId: session.user.id,
      }

      const newKnowledgeBase = await createKnowledgeBase(createData, requestId)

      try {
        PlatformEvents.knowledgeBaseCreated({
          knowledgeBaseId: newKnowledgeBase.id,
          name: validatedData.name,
          workspaceId: validatedData.workspaceId,
        })
      } catch {
        // Telemetry should not fail the operation
      }

      logger.info(
        `[${requestId}] Knowledge base created: ${newKnowledgeBase.id} for user ${session.user.id}`
      )

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
