import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createKnowledgeBase, getKnowledgeBases } from '@/lib/knowledge/service'
import {
  authenticateRequest,
  formatKnowledgeBase,
  handleError,
  parseJsonBody,
  validateSchema,
  validateWorkspaceAccess,
} from '@/app/api/v1/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ListKBSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
})

const ChunkingConfigSchema = z.object({
  maxSize: z.number().min(100).max(4000).default(1024),
  minSize: z.number().min(1).max(2000).default(100),
  overlap: z.number().min(0).max(500).default(200),
})

const CreateKBSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  name: z.string().min(1, 'Name is required').max(255, 'Name must be 255 characters or less'),
  description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
  chunkingConfig: ChunkingConfigSchema.optional().default({
    maxSize: 1024,
    minSize: 100,
    overlap: 200,
  }),
})

/** GET /api/v1/knowledge — List knowledge bases in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await authenticateRequest(request, 'knowledge')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const { searchParams } = new URL(request.url)
    const validation = validateSchema(ListKBSchema, {
      workspaceId: searchParams.get('workspaceId'),
    })
    if (!validation.success) return validation.response

    const { workspaceId } = validation.data

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId)
    if (accessError) return accessError

    const knowledgeBases = await getKnowledgeBases(userId, workspaceId)

    return NextResponse.json({
      success: true,
      data: {
        knowledgeBases: knowledgeBases.map(formatKnowledgeBase),
        totalCount: knowledgeBases.length,
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to list knowledge bases')
  }
})

/** POST /api/v1/knowledge — Create a new knowledge base. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await authenticateRequest(request, 'knowledge')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const body = await parseJsonBody(request)
    if (!body.success) return body.response

    const validation = validateSchema(CreateKBSchema, body.data)
    if (!validation.success) return validation.response

    const { workspaceId, name, description, chunkingConfig } = validation.data

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (accessError) return accessError

    const kb = await createKnowledgeBase(
      {
        name,
        description,
        workspaceId,
        userId,
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
        chunkingConfig: chunkingConfig ?? { maxSize: 1024, minSize: 100, overlap: 200 },
      },
      requestId
    )

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.KNOWLEDGE_BASE_CREATED,
      resourceType: AuditResourceType.KNOWLEDGE_BASE,
      resourceId: kb.id,
      resourceName: kb.name,
      description: `Created knowledge base "${kb.name}" via API`,
      metadata: { chunkingConfig },
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        knowledgeBase: formatKnowledgeBase(kb),
        message: 'Knowledge base created successfully',
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to create knowledge base')
  }
})
