import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { NextRequest } from 'next/server'
import {
  knowledgeMcpContract,
  organizationKnowledgeMcpContract,
} from '@/lib/api/contracts/knowledge/mcp'
import { parseRequest } from '@/lib/api/server'
import {
  authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError,
} from '@/lib/api/server/routes/v2-api-key-auth'
import { admitV2Request, v2RateLimits } from '@/lib/api/server/routes/v2-json-route'
import { OAUTH_ACCESS_TOKEN_PREFIX } from '@/lib/auth/oauth-provider'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readSearchIndex } from '@/lib/knowledge/application/sim-search'
import { withSearchMcpAuthChallenge } from '@/lib/knowledge/mcp/oauth-metadata'
import { createKnowledgeMcpServer } from '@/lib/knowledge/mcp/server'
import { getSearchMcpUrl } from '@/lib/knowledge/mcp/urls'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

function mcpAuth(resource: string) {
  return {
    authenticate(request: NextRequest) {
      const apiKey = request.headers.get('x-api-key')
      const authorization = request.headers.get('authorization')
      const bearer = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
      if ((authorization && !bearer) || (apiKey && bearer && apiKey !== bearer)) {
        throw new V2ApiKeyUnauthenticatedError('Provide one valid API key')
      }
      /** MCP clients also send existing Sim API keys as bearer credentials. */
      const oauthBearer = bearer?.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) ? bearer : null
      return authenticateV2ApiKey(
        {
          apiKey: apiKey ?? (oauthBearer ? null : (bearer ?? null)),
          bearer: oauthBearer,
        },
        { resource, allowUnboundApiTokens: true }
      )
    },
  }
}

export function createKnowledgeMcpHandlers(kind: 'workspace' | 'organization') {
  /** JSON-RPC is a protocol boundary; SDK dispatch calls the same authorized knowledge use cases. */
  const handler = withRouteHandler(
    async (
      request: NextRequest,
      context: { params: Promise<{ workspaceId?: string; organizationId?: string }> }
    ) => {
      const params = await context.params
      const id = kind === 'workspace' ? params.workspaceId : params.organizationId
      const resource = getSearchMcpUrl(kind, id ?? '')
      const admission = await admitV2Request(
        request,
        knowledgeOperations.readSearchIndex,
        mcpAuth(resource),
        v2RateLimits.publicApi
      )
      if (!admission.success) return withSearchMcpAuthChallenge(admission.response, resource)
      const origin = request.headers.get('origin')
      if (origin && origin !== new URL(getBaseUrl()).origin) {
        return v2Error('FORBIDDEN', 'Origin is not allowed')
      }
      try {
        const parsed = await parseRequest(
          kind === 'workspace' ? knowledgeMcpContract : organizationKnowledgeMcpContract,
          request,
          context,
          {
            maxBodyBytes: 64 * 1024,
          }
        )
        if (!parsed.success) return parsed.response
        const index = await readSearchIndex.execute({
          principal: admission.auth.principal,
          input: parsed.data.params,
          request,
        })
        const server = createKnowledgeMcpServer({
          request,
          auth: admission.auth,
          ...parsed.data.params,
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
        if (response) return withSearchMcpAuthChallenge(response, resource)
        throw error
      }
    }
  )

  /** Stateless clients use POST only; authenticate unsupported methods before returning 405. */
  const unsupportedMethod = withRouteHandler(
    async (
      request: NextRequest,
      context: { params: Promise<{ workspaceId?: string; organizationId?: string }> }
    ) => {
      const params = await context.params
      const id = kind === 'workspace' ? params.workspaceId : params.organizationId
      const resource = getSearchMcpUrl(kind, id ?? '')
      const admission = await admitV2Request(
        request,
        knowledgeOperations.readSearchIndex,
        mcpAuth(resource),
        v2RateLimits.publicApi
      )
      if (!admission.success) return withSearchMcpAuthChallenge(admission.response, resource)
      return new Response(null, {
        status: 405,
        headers: { Allow: 'POST', 'Cache-Control': 'private, no-store' },
      })
    }
  )

  return { POST: handler, GET: unsupportedMethod, DELETE: unsupportedMethod }
}
