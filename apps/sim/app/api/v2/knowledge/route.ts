import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2CreateKnowledgeBaseContract,
  v2ListKnowledgeBasesContract,
} from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { performCreateKnowledgeBase } from '@/lib/knowledge/orchestration'
import { getKnowledgeBases } from '@/lib/knowledge/service'
import { formatKnowledgeBase } from '@/app/api/v1/knowledge/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  folderPathForId,
  resolveFolderPathId,
  withResolvedFolderPathMutation,
} from '@/app/api/v2/lib/folders'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
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

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListKnowledgeBasesContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, folderPath, search, sortBy, sortOrder } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'knowledge_base')
    const folderId =
      folderPath === undefined ? undefined : resolveFolderPathId(folderIndex, folderPath)
    if (folderPath !== undefined && folderId === undefined) {
      return v2Error('NOT_FOUND', 'Folder not found')
    }

    const knowledgeBases = await getKnowledgeBases(userId, workspaceId, 'active', {
      folderId,
      search,
      sortBy,
      sortOrder,
    })
    const items = knowledgeBases.map((knowledgeBase) => ({
      ...formatKnowledgeBase(knowledgeBase),
      folderPath: folderPathForId(folderIndex, knowledgeBase.folderId),
    }))

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

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateKnowledgeBaseContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, name, description, chunkingConfig, folderPath } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const mutation = await withResolvedFolderPathMutation({
      workspaceId,
      resourceType: 'knowledge_base',
      path: folderPath ?? '/',
      mutate: (folderId) =>
        performCreateKnowledgeBase({
          userId,
          source: 'api',
          workspaceId,
          name,
          description,
          chunkingConfig,
          folderId,
          requestId,
          request,
        }),
    })
    if (!mutation.found) return v2Error('NOT_FOUND', 'Folder not found')
    const outcome = mutation.value
    if (!outcome.success) {
      return v2ErrorForOrchestration(outcome.errorCode, outcome.error)
    }

    return v2Data(
      {
        knowledgeBase: {
          ...formatKnowledgeBase(outcome.knowledgeBase),
          folderPath: folderPathForId(mutation.index, outcome.knowledgeBase.folderId),
        },
      },
      { rateLimit, status: 201 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error creating knowledge base`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
