import { type NextRequest, NextResponse } from 'next/server'
import {
  v1DeleteKnowledgeBaseContract,
  v1GetKnowledgeBaseContract,
  v1UpdateKnowledgeBaseContract,
} from '@/lib/api/contracts/v1/knowledge'
import { parseRequest } from '@/lib/api/server'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  performDeleteKnowledgeBase,
  performUpdateKnowledgeBase,
} from '@/lib/knowledge/orchestration'
import {
  formatKnowledgeBase,
  handleError,
  resolveKnowledgeBase,
} from '@/app/api/v1/knowledge/utils'
import { authenticateRequest, v1ValidationErrorResponse } from '@/app/api/v1/middleware'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface KnowledgeRouteParams {
  params: Promise<{ id: string }>
}

/** GET /api/v1/knowledge/[id] — Get knowledge base details. */
export const GET = withRouteHandler(async (request: NextRequest, context: KnowledgeRouteParams) => {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const parsed = await parseRequest(v1GetKnowledgeBaseContract, request, context, {
      validationErrorResponse: v1ValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const result = await resolveKnowledgeBase(id, parsed.data.query.workspaceId, userId, rateLimit)
    if (result instanceof NextResponse) return result

    return NextResponse.json({
      success: true,
      data: {
        knowledgeBase: formatKnowledgeBase(result.kb),
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to get knowledge base')
  }
})

/** PUT /api/v1/knowledge/[id] — Update a knowledge base. */
export const PUT = withRouteHandler(async (request: NextRequest, context: KnowledgeRouteParams) => {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const parsed = await parseRequest(v1UpdateKnowledgeBaseContract, request, context, {
      validationErrorResponse: v1ValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, name, description, chunkingConfig } = parsed.data.body

    const result = await resolveKnowledgeBase(id, workspaceId, userId, rateLimit, 'write')
    if (result instanceof NextResponse) return result

    const outcome = await performUpdateKnowledgeBase({
      knowledgeBaseId: id,
      workspaceId,
      userId,
      source: 'api',
      updates: { name, description, chunkingConfig },
      requestId,
      request,
    })
    if (!outcome.success) {
      return NextResponse.json(
        { error: messageForOrchestrationError(outcome, 'Failed to update knowledge base') },
        { status: statusForOrchestrationError(outcome.errorCode) }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        knowledgeBase: formatKnowledgeBase(outcome.knowledgeBase),
        message: 'Knowledge base updated successfully',
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to update knowledge base')
  }
})

/** DELETE /api/v1/knowledge/[id] — Delete a knowledge base. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: KnowledgeRouteParams) => {
    const auth = await authenticateRequest(request, 'knowledge-detail')
    if (auth instanceof NextResponse) return auth
    const { requestId, userId, rateLimit } = auth

    try {
      const parsed = await parseRequest(v1DeleteKnowledgeBaseContract, request, context, {
        validationErrorResponse: v1ValidationErrorResponse,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const result = await resolveKnowledgeBase(
        id,
        parsed.data.query.workspaceId,
        userId,
        rateLimit,
        'write'
      )
      if (result instanceof NextResponse) return result

      const outcome = await performDeleteKnowledgeBase({
        knowledgeBase: {
          id,
          name: result.kb.name,
          workspaceId: parsed.data.query.workspaceId,
        },
        userId,
        source: 'api',
        requestId,
        request,
      })
      if (!outcome.success) {
        return NextResponse.json(
          { error: messageForOrchestrationError(outcome, 'Failed to delete knowledge base') },
          { status: statusForOrchestrationError(outcome.errorCode) }
        )
      }

      return NextResponse.json({
        success: true,
        data: {
          message: 'Knowledge base deleted successfully',
        },
      })
    } catch (error) {
      return handleError(requestId, error, 'Failed to delete knowledge base')
    }
  }
)
