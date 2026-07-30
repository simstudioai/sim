import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2CreateKnowledgeBaseContract,
  v2ListKnowledgeBasesContract,
} from '@/lib/api/contracts/v2/knowledge'
import { isZodError, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { EMBEDDING_DIMENSIONS, getConfiguredEmbeddingModel } from '@/lib/knowledge/embeddings'
import { createKnowledgeBase, getKnowledgeBases } from '@/lib/knowledge/service'
import { formatKnowledgeBase } from '@/app/api/v1/knowledge/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2KnowledgeAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/knowledge — List knowledge bases in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'knowledge')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2ListKnowledgeBasesContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const knowledgeBases = await getKnowledgeBases(userId, workspaceId)
    const items = knowledgeBases.map(formatKnowledgeBase)

    // `getKnowledgeBases` returns the full bounded workspace set → single page.
    return v2CursorList(items, null, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error listing knowledge bases`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/knowledge — Create a new knowledge base. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'knowledge')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2CreateKnowledgeBaseContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, name, description, chunkingConfig } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

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

    return v2Data({ knowledgeBase: formatKnowledgeBase(kb) }, { rateLimit, status: 201 })
  } catch (error) {
    if (isZodError(error)) return v2ValidationError(error)

    if (error instanceof Error) {
      if (error.message.includes('does not have permission')) {
        return v2Error('FORBIDDEN', 'Access denied')
      }
      if (
        error.message.includes('Storage limit exceeded') ||
        error.message.includes('storage limit')
      ) {
        return v2Error('PAYLOAD_TOO_LARGE', 'Storage limit exceeded')
      }
      if (error.message.includes('already exists')) {
        return v2Error('CONFLICT', 'Resource already exists')
      }
    }

    logger.error(`[${requestId}] Error creating knowledge base`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
