import {
  v2CreateKnowledgeBaseContract,
  v2ListKnowledgeBasesContract,
} from '@/lib/api/contracts/v2/knowledge'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { performCreateKnowledgeBase } from '@/lib/knowledge/orchestration'
import { getKnowledgeBases } from '@/lib/knowledge/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { formatKnowledgeBase } from '@/app/api/v1/knowledge/utils'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  folderPathForId,
  resolveFolderPathId,
  resolveFolderPathIdentity,
} from '@/app/api/v2/lib/folders'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/knowledge — List knowledge bases in a workspace. */
export const GET = withPublicApiRouteHandler({
  contract: v2ListKnowledgeBasesContract,
  rateLimitEndpoint: 'knowledge',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, folderPath, search, sortBy, sortOrder } = input.query

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
  },
})

/** POST /api/v2/knowledge — Create a new knowledge base. */
export const POST = withPublicApiRouteHandler({
  contract: v2CreateKnowledgeBaseContract,
  rateLimitEndpoint: 'knowledge',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    const { workspaceId, name, description, chunkingConfig, folderPath } = input.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const resolution = await resolveFolderPathIdentity({
      workspaceId,
      resourceType: 'knowledge_base',
      path: folderPath ?? '/',
    })
    if (!resolution.found) return v2Error('NOT_FOUND', 'Folder not found')

    const outcome = await performCreateKnowledgeBase({
      userId,
      source: 'api',
      workspaceId,
      name,
      description,
      chunkingConfig,
      folderId: resolution.folderId,
      requestId,
      request,
    })
    if (!outcome.success) {
      return v2ErrorForOrchestration(outcome.errorCode, outcome.error)
    }

    return v2Data(
      {
        knowledgeBase: {
          ...formatKnowledgeBase(outcome.knowledgeBase),
          folderPath: folderPathForId(resolution.index, outcome.knowledgeBase.folderId),
        },
      },
      { rateLimit, status: 201 }
    )
  },
})
