import { type NextRequest, NextResponse } from 'next/server'
import {
  v1CreateKnowledgeBaseContract,
  v1ListKnowledgeBasesContract,
} from '@/lib/api/contracts/v1/knowledge'
import { parseRequest } from '@/lib/api/server'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performCreateKnowledgeBase } from '@/lib/knowledge/orchestration'
import {
  getLegacyPersonalKnowledgeBases,
  getWorkspaceKnowledgeBases,
} from '@/lib/knowledge/service'
import { formatKnowledgeBase, handleError } from '@/app/api/v1/knowledge/utils'
import {
  authenticateRequest,
  v1ValidationErrorResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v1/knowledge — List knowledge bases in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await authenticateRequest(request, 'knowledge')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const parsed = await parseRequest(
      v1ListKnowledgeBasesContract,
      request,
      {},
      {
        validationErrorResponse: v1ValidationErrorResponse,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId)
    if (accessError) return accessError

    /**
     * The workspace's own rows, read after `validateWorkspaceAccess` has authorized this
     * caller rather than re-deriving that access inside the row query, plus the caller's
     * legacy workspace-less bases, which belong to no workspace and answer only to their
     * creator. This is the shape the internal list serves too.
     */
    const [workspaceBases, legacyPersonalBases] = await Promise.all([
      getWorkspaceKnowledgeBases(workspaceId),
      getLegacyPersonalKnowledgeBases(userId),
    ])
    const knowledgeBases = [...workspaceBases.data, ...legacyPersonalBases].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )

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
    const parsed = await parseRequest(
      v1CreateKnowledgeBaseContract,
      request,
      {},
      {
        validationErrorResponse: v1ValidationErrorResponse,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, name, description, chunkingConfig } = parsed.data.body

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (accessError) return accessError

    const outcome = await performCreateKnowledgeBase({
      userId,
      source: 'api',
      workspaceId,
      name,
      description,
      chunkingConfig,
      requestId,
      request,
    })
    if (!outcome.success) {
      return NextResponse.json(
        { error: messageForOrchestrationError(outcome, 'Failed to create knowledge base') },
        { status: statusForOrchestrationError(outcome.errorCode) }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        knowledgeBase: formatKnowledgeBase(outcome.knowledgeBase),
        message: 'Knowledge base created successfully',
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to create knowledge base')
  }
})
