import { NextResponse } from 'next/server'
import {
  v2DeleteKnowledgeBaseContract,
  v2GetKnowledgeBaseContract,
  v2UpdateKnowledgeBaseContract,
} from '@/lib/api/contracts/v2/knowledge'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import {
  performDeleteKnowledgeBase,
  performUpdateKnowledgeBase,
} from '@/lib/knowledge/orchestration'
import type { KnowledgeBaseWithCounts } from '@/lib/knowledge/types'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { formatKnowledgeBase, resolveKnowledgeBase } from '@/app/api/v1/knowledge/utils'
import type { RateLimitResult } from '@/app/api/v1/middleware'
import { folderPathForId, resolveFolderPathIdentity } from '@/app/api/v2/lib/folders'
import { v2Data, v2Error, v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
export const GET = withPublicApiRouteHandler({
  contract: v2GetKnowledgeBaseContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { id } = input.params
    const result = await resolveKnowledgeBaseScoped(
      id,
      input.query.workspaceId,
      userId,
      rateLimit,
      'read'
    )
    if (result instanceof NextResponse) return result

    const folderIndex = await loadActiveFolderPathIndex(input.query.workspaceId, 'knowledge_base')

    return v2Data(
      {
        knowledgeBase: {
          ...formatKnowledgeBase(result.kb),
          folderPath: folderPathForId(folderIndex, result.kb.folderId),
        },
      },
      { rateLimit }
    )
  },
})

/** PUT /api/v2/knowledge/[id] — Update a knowledge base. */
export const PUT = withPublicApiRouteHandler({
  contract: v2UpdateKnowledgeBaseContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    const { id } = input.params
    const { workspaceId, name, description, chunkingConfig, folderPath } = input.body

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
  },
})

/** DELETE /api/v2/knowledge/[id] — Delete a knowledge base. */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteKnowledgeBaseContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    const { id } = input.params
    const result = await resolveKnowledgeBaseScoped(
      id,
      input.query.workspaceId,
      userId,
      rateLimit,
      'write'
    )
    if (result instanceof NextResponse) return result

    const outcome = await performDeleteKnowledgeBase({
      knowledgeBase: { id, name: result.kb.name, workspaceId: input.query.workspaceId },
      userId,
      source: 'api',
      requestId,
      request,
    })
    if (!outcome.success) {
      return v2ErrorForOrchestration(outcome.errorCode, outcome.error)
    }

    return v2Data({ id, deleted: true as const }, { rateLimit })
  },
})
