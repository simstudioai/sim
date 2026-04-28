import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createKnowledgeBase,
  getKnowledgeBases,
  KnowledgeBaseConflictError,
  type KnowledgeBaseScope,
} from '@/lib/knowledge/service'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('KnowledgeBaseAPI')

const CreateKnowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  embeddingModel: z.literal('text-embedding-3-small').default('text-embedding-3-small'),
  embeddingDimension: z.literal(1536).default(1536),
  chunkingConfig: z
    .object({
      maxSize: z.number().min(100).max(4000).default(1024),
      minSize: z.number().min(1).max(2000).default(100),
      overlap: z.number().min(0).max(500).default(200),
      strategy: z
        .enum(['auto', 'text', 'regex', 'recursive', 'sentence', 'token'])
        .default('auto')
        .optional(),
      strategyOptions: z
        .object({
          pattern: z.string().max(500).optional(),
          separators: z.array(z.string()).optional(),
          recipe: z.enum(['plain', 'markdown', 'code']).optional(),
        })
        .optional(),
    })
    .default({
      maxSize: 1024,
      minSize: 100,
      overlap: 200,
    })
    .refine(
      (data) => {
        const maxSizeInChars = data.maxSize * 4
        return data.minSize < maxSizeInChars
      },
      {
        message: 'Min chunk size (characters) must be less than max chunk size (tokens × 4)',
      }
    )
    .refine(
      (data) => {
        return data.overlap < data.maxSize
      },
      {
        message: 'Overlap must be less than max chunk size',
      }
    )
    .refine(
      (data) => {
        if (data.strategy === 'regex' && !data.strategyOptions?.pattern) {
          return false
        }
        return true
      },
      {
        message: 'Regex pattern is required when using the regex chunking strategy',
      }
    ),
})

export const GET = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')
    const scope = (searchParams.get('scope') ?? 'active') as KnowledgeBaseScope
    if (!['active', 'archived', 'all'].includes(scope)) {
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
    }

    const knowledgeBasesWithCounts = await getKnowledgeBases(session.user.id, workspaceId, scope)

    return NextResponse.json({
      success: true,
      data: knowledgeBasesWithCounts,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching knowledge bases`, error)
    return NextResponse.json({ error: 'Failed to fetch knowledge bases' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (req: NextRequest) => {
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

      captureServerEvent(
        session.user.id,
        'knowledge_base_created',
        {
          knowledge_base_id: newKnowledgeBase.id,
          workspace_id: validatedData.workspaceId,
          name: validatedData.name,
        },
        {
          groups: { workspace: validatedData.workspaceId },
          setOnce: { first_kb_created_at: new Date().toISOString() },
        }
      )

      logger.info(
        `[${requestId}] Knowledge base created: ${newKnowledgeBase.id} for user ${session.user.id}`
      )

      recordAudit({
        workspaceId: validatedData.workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.KNOWLEDGE_BASE_CREATED,
        resourceType: AuditResourceType.KNOWLEDGE_BASE,
        resourceId: newKnowledgeBase.id,
        resourceName: validatedData.name,
        description: `Created knowledge base "${validatedData.name}"`,
        metadata: {
          name: validatedData.name,
          description: validatedData.description,
          embeddingModel: validatedData.embeddingModel,
          embeddingDimension: validatedData.embeddingDimension,
          chunkingStrategy: validatedData.chunkingConfig.strategy,
          chunkMaxSize: validatedData.chunkingConfig.maxSize,
          chunkMinSize: validatedData.chunkingConfig.minSize,
          chunkOverlap: validatedData.chunkingConfig.overlap,
        },
        request: req,
      })

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
    if (error instanceof KnowledgeBaseConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    logger.error(`[${requestId}] Error creating knowledge base`, error)
    return NextResponse.json({ error: 'Failed to create knowledge base' }, { status: 500 })
  }
})
