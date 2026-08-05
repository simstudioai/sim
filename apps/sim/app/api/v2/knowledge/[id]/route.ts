import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v2DeleteKnowledgeBaseContract,
  v2GetKnowledgeBaseContract,
  v2UpdateKnowledgeBaseContract,
} from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import {
  performDeleteKnowledgeBase,
  performUpdateKnowledgeBase,
} from '@/lib/knowledge/orchestration'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { formatKnowledgeBase, resolveKnowledgeBase } from '@/app/api/v1/knowledge/utils'
import { checkRateLimit, type RateLimitResult } from '@/app/api/v1/middleware'
import { folderPathForId, resolveFolderPathIdentity } from '@/app/api/v2/lib/folders'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2KnowledgeDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface KnowledgeRouteParams {
  params: Promise<{ id: string }>
}

/**
 * Resolves a knowledge base via the shared v1 ownership invariant
 * ({@link resolveKnowledgeBase}: workspace access + KB-belongs-to-workspace) and
 * renders any failure in the v2 envelope. A `404` (missing KB or workspace
 * mismatch) is always `NOT_FOUND`; a `403` (no workspace access) is masked as
 * `NOT_FOUND` on reads so cross-workspace KB existence never leaks, and surfaced
 * as `FORBIDDEN` on writes.
 */
async function resolveKnowledgeBaseScoped(
  id: string,
  workspaceId: string,
  userId: string,
  rateLimit: RateLimitResult,
  level: 'read' | 'write'
): Promise<{ kb: KnowledgeBaseWithCounts } | NextResponse> {
  const result = await resolveKnowledgeBase(id, workspaceId, userId, rateLimit, level)
  if (!(result instanceof NextResponse)) return result
  if (result.status === 404) return v2Error('NOT_FOUND', 'Knowledge base not found')
  return level === 'read'
    ? v2Error('NOT_FOUND', 'Knowledge base not found')
    : v2Error('FORBIDDEN', 'Access denied')
}

/** GET /api/v2/knowledge/[id] — Get knowledge base details. */
export const GET = withRouteHandler(async (request: NextRequest, context: KnowledgeRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'knowledge-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetKnowledgeBaseContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const result = await resolveKnowledgeBaseScoped(
      id,
      parsed.data.query.workspaceId,
      userId,
      rateLimit,
      'read'
    )
    if (result instanceof NextResponse) return result

    const folderIndex = await loadActiveFolderPathIndex(
      parsed.data.query.workspaceId,
      'knowledge_base'
    )

    return v2Data(
      {
        knowledgeBase: {
          ...formatKnowledgeBase(result.kb),
          folderPath: folderPathForId(folderIndex, result.kb.folderId),
        },
      },
      { rateLimit }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error getting knowledge base`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** PUT /api/v2/knowledge/[id] — Update a knowledge base. */
export const PUT = withRouteHandler(async (request: NextRequest, context: KnowledgeRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'knowledge-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateKnowledgeBaseContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, name, description, chunkingConfig, folderPath } = parsed.data.body

    const result = await resolveKnowledgeBaseScoped(id, workspaceId, userId, rateLimit, 'write')
    if (result instanceof NextResponse) return result

    const resolution =
      folderPath === undefined
        ? undefined
        : await resolveFolderPathIdentity({
            workspaceId,
            resourceType: 'knowledge_base',
            path: folderPath,
          })
    if (resolution && !resolution.found) {
      return v2Error('NOT_FOUND', 'Folder not found')
    }

    const outcome = await performUpdateKnowledgeBase({
      knowledgeBaseId: id,
      workspaceId,
      userId,
      source: 'api',
      updates: { name, description, chunkingConfig, folderId: resolution?.folderId },
      requestId,
      request,
    })
    if (!outcome.success) {
      return v2ErrorForOrchestration(outcome.errorCode, outcome.error)
    }

    const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'knowledge_base')
    return v2Data(
      {
        knowledgeBase: {
          ...formatKnowledgeBase(outcome.knowledgeBase),
          folderPath: folderPathForId(folderIndex, outcome.knowledgeBase.folderId),
        },
      },
      { rateLimit }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error updating knowledge base`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/knowledge/[id] — Delete a knowledge base. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: KnowledgeRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'knowledge-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2DeleteKnowledgeBaseContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const result = await resolveKnowledgeBaseScoped(
        id,
        parsed.data.query.workspaceId,
        userId,
        rateLimit,
        'write'
      )
      if (result instanceof NextResponse) return result

      const outcome = await performDeleteKnowledgeBase({
        knowledgeBase: { id, name: result.kb.name, workspaceId: parsed.data.query.workspaceId },
        userId,
        source: 'api',
        requestId,
        request,
      })
      if (!outcome.success) {
        return v2ErrorForOrchestration(outcome.errorCode, outcome.error)
      }

      return v2Data({ id, deleted: true as const }, { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting knowledge base`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
