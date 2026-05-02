import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1CreateKnowledgeBaseContract,
  v1ListKnowledgeBasesContract,
} from '@/lib/api/contracts/v1/knowledge'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { EMBEDDING_DIMENSIONS, getConfiguredEmbeddingModel } from '@/lib/knowledge/embeddings'
import { createKnowledgeBase, getKnowledgeBases } from '@/lib/knowledge/service'
import { formatKnowledgeBase, handleError } from '@/app/api/v1/knowledge/utils'
import { authenticateRequest, validateWorkspaceAccess } from '@/app/api/v1/middleware'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v1/knowledge — List knowledge bases in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await authenticateRequest(request, 'knowledge')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const parsed = await parseRequest(v1ListKnowledgeBasesContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

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
    const parsed = await parseRequest(v1CreateKnowledgeBaseContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId, name, description, chunkingConfig } = parsed.data.body

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (accessError) return accessError

    const kb = await createKnowledgeBase(
      {
        name,
        description,
        workspaceId,
        userId,
        embeddingModel: getConfiguredEmbeddingModel(),
        embeddingDimension: EMBEDDING_DIMENSIONS,
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
