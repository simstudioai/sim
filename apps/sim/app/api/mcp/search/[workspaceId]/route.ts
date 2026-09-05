import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { NextRequest } from 'next/server'
import { knowledgeMcpContract } from '@/lib/api/contracts/knowledge/mcp'
import { parseRequest } from '@/lib/api/server'
import {
  authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError,
} from '@/lib/api/server/routes/v2-api-key-auth'
import { admitV2Request, v2RateLimits } from '@/lib/api/server/routes/v2-json-route'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readSearchIndex } from '@/lib/knowledge/application/sim-search'
import { createKnowledgeMcpServer } from '@/lib/knowledge/mcp/server'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'

const mcpApiKeyAuth = {
  authenticate(request: NextRequest) {
    const apiKey = request.headers.get('x-api-key')
    const authorization = request.headers.get('authorization')
    const bearer = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
    if ((authorization && !bearer) || (apiKey && bearer && apiKey !== bearer)) {
      throw new V2ApiKeyUnauthenticatedError('Provide one valid API key')
    }
    return authenticateV2ApiKey(apiKey ?? bearer ?? null)
  },
}

/** JSON-RPC is a protocol boundary; SDK dispatch calls the same authorized knowledge use cases. */
const handler = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) => {
    const admission = await admitV2Request(
      request,
      knowledgeOperations.readSearchIndex,
      mcpApiKeyAuth,
      v2RateLimits.publicApi
    )
    if (!admission.success) return admission.response
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(getBaseUrl()).origin) {
      return v2Error('FORBIDDEN', 'Origin is not allowed')
    }
    try {
      const parsed = await parseRequest(knowledgeMcpContract, request, context, {
        maxBodyBytes: 64 * 1024,
      })
      if (!parsed.success) return parsed.response
      const index = await readSearchIndex.execute({
        principal: admission.auth.principal,
        input: { workspaceId: parsed.data.params.workspaceId },
        request,
      })
      const server = createKnowledgeMcpServer({
        request,
        auth: admission.auth,
        workspaceId: index.workspaceId,
        searchIndexId: index.knowledgeBaseId,
      })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      try {
        await server.connect(transport)
        const response = await transport.handleRequest(request, { parsedBody: parsed.data.body })
        response.headers.set('Cache-Control', 'private, no-store')
        return response
      } finally {
        await server.close()
      }
    } catch (error) {
      const response = v2CaughtOrchestrationError(error)
      if (response) return response
      throw error
    }
  }
)

export const POST = handler

/** Stateless clients use POST only; authenticate unsupported methods before returning 405. */
const unsupportedMethod = withRouteHandler(async (request: NextRequest) => {
  const admission = await admitV2Request(
    request,
    knowledgeOperations.readSearchIndex,
    mcpApiKeyAuth,
    v2RateLimits.publicApi
  )
  if (!admission.success) return admission.response
  return new Response(null, {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'private, no-store' },
  })
})

export const GET = unsupportedMethod
export const DELETE = unsupportedMethod
