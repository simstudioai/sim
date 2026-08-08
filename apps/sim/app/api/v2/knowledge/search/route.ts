import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { v2SearchKnowledgeContract } from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { v2ApiKeyAuth, v2OrchestrationErrorPolicy, v2RateLimits } from '@/lib/api/server/routes'
import type { JsonRouteContext } from '@/lib/api/server/routes/types'
import { admitV2Request, V2RouteInfrastructureError } from '@/lib/api/server/routes/v2-json-route'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { v2Error, v2ValidationError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** POST /api/v2/knowledge/search — Vector / tag search across knowledge bases. */
export const POST = withRouteHandler<JsonRouteContext | undefined>(
  async (request: NextRequest, context) => {
    if (request.method !== v2SearchKnowledgeContract.method) {
      throw new Error(
        `Route received ${request.method} for ${v2SearchKnowledgeContract.method} contract ${v2SearchKnowledgeContract.path}`
      )
    }

    const admission = await admitV2Request(
      request,
      knowledgeOperations.search,
      v2ApiKeyAuth,
      v2RateLimits.publicApi
    )
    if (!admission.success) return admission.response

    const parsed = await parseRequest(v2SearchKnowledgeContract, request, context ?? {}, {
      validationErrorResponse: v2ValidationError,
      invalidJsonResponse: () => v2Error('BAD_REQUEST', 'Request body must be valid JSON'),
    })
    if (!parsed.success) return parsed.response

    const { body } = parsed.data
    try {
      const result = await searchKnowledge.execute({
        principal: admission.auth.principal,
        input: {
          workspaceId: body.workspaceId,
          knowledgeBaseIds: Array.isArray(body.knowledgeBaseIds)
            ? body.knowledgeBaseIds
            : [body.knowledgeBaseIds],
          query: body.query,
          topK: body.topK,
          tagFilters: body.tagFilters,
        },
        request,
      })
      const responseBody = v2SearchKnowledgeContract.response.schema.parse({ data: result })
      return NextResponse.json(responseBody, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    } catch (error) {
      if (error instanceof KnowledgeUsageLimitExceededError) {
        return v2Error('USAGE_LIMIT_EXCEEDED', error.message)
      }
      const response = v2OrchestrationErrorPolicy.render(error)
      if (response) return response
      throw error
    }
  },
  {
    unhandledErrorResponse: ({ error }) =>
      error instanceof V2RouteInfrastructureError
        ? v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')
        : v2Error('INTERNAL_ERROR', 'Internal server error'),
  }
)
