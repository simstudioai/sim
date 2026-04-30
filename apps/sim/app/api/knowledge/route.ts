import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createKnowledgeBaseContract,
  listKnowledgeBasesQuerySchema,
} from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { EMBEDDING_DIMENSIONS, getConfiguredEmbeddingModel } from '@/lib/knowledge/embeddings'
import {
  createKnowledgeBase,
  getKnowledgeBases,
  KnowledgeBaseConflictError,
  type KnowledgeBaseScope,
} from '@/lib/knowledge/service'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('KnowledgeBaseAPI')

export const GET = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const query = listKnowledgeBasesQuerySchema.safeParse({
      workspaceId: searchParams.get('workspaceId') ?? undefined,
      scope: searchParams.get('scope') ?? undefined,
    })
    if (!query.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: query.error.issues },
        { status: 400 }
      )
    }
    const { workspaceId, scope } = query.data

    const knowledgeBasesWithCounts = await getKnowledgeBases(
      session.user.id,
      workspaceId,
      scope as KnowledgeBaseScope
    )

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

    const parsed = await parseRequest(
      createKnowledgeBaseContract,
      req,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid knowledge base data`, { errors: error.issues })
          return NextResponse.json(
            { error: 'Invalid request data', details: error.issues },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const validatedData = parsed.data.body

    try {
      const embeddingModel = getConfiguredEmbeddingModel()

      const createData = {
        ...validatedData,
        userId: session.user.id,
        embeddingModel,
        embeddingDimension: EMBEDDING_DIMENSIONS,
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
          embeddingModel,
          embeddingDimension: EMBEDDING_DIMENSIONS,
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
    } catch (createError) {
      if (createError instanceof KnowledgeBaseConflictError) {
        return NextResponse.json({ error: createError.message }, { status: 409 })
      }
      throw createError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error creating knowledge base`, error)
    return NextResponse.json({ error: 'Failed to create knowledge base' }, { status: 500 })
  }
})
