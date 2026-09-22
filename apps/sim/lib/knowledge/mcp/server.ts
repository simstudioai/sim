import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { parseRetryAfter } from '@sim/utils/retry'
import type { NextRequest } from 'next/server'
import {
  chatSearchMcpSchema,
  liveSearchMcpSchema,
  readDocumentMcpSchema,
  readLiveDocumentMcpSchema,
  searchMcpSchema,
} from '@/lib/api/contracts/knowledge/mcp'
import type { V2ApiKeyAuthContext } from '@/lib/api/server/routes/v2-api-key-auth'
import { v2RateLimits } from '@/lib/api/server/routes/v2-json-route'
import type { ApplicationOperation } from '@/lib/core/application'
import { isLiveEnterpriseSearchEnabled } from '@/lib/core/config/env-flags'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { afterResponse } from '@/lib/core/utils/after-response'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { organizationSearchChatOperation } from '@/lib/knowledge/application/chat-operations'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readIndexedKnowledgeDocument } from '@/lib/knowledge/application/read-indexed-document'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import {
  recordOrganizationSearchMcpActivity,
  type SearchMcpActivityInput,
} from '@/lib/knowledge/mcp/activity'
import { createKnowledgeDocumentCitation, liveCitationId } from '@/lib/knowledge/search/citation'
import { toolError } from '@/lib/mcp/tool-result'
import { readLiveDocument, searchLiveKnowledge } from '@/lib/sim-search/live/application'
import { v2CaughtOrchestrationError } from '@/app/api/v2/lib/response'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('KnowledgeMcp')
const MAX_RESULT_BYTES = 1024 * 1024
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

interface KnowledgeMcpContext {
  organizationId: string
  request: NextRequest
  auth: V2ApiKeyAuthContext
  searchIndexId: string | null
}

function projectResult(value: unknown, registry: ResolvedSecretTraceRegistry): CallToolResult {
  if (!registry.isComplete()) {
    return toolError(
      'Document secret provenance is unavailable. The content cannot be returned safely.'
    )
  }
  const projected = projectResolvedSecretModelContent(value, registry, MAX_RESULT_BYTES)
  if (!projected.safe) {
    return toolError('This result cannot be safely returned. Try a smaller result page.')
  }
  const text = JSON.stringify(projected.value)
  if (Buffer.byteLength(text) > MAX_RESULT_BYTES) {
    return toolError('Result is too large. Request fewer results or a smaller page.')
  }
  return { content: [{ type: 'text', text }] }
}

/** A request owns its server; no credential or principal survives into another HTTP request. */
export function createKnowledgeMcpServer(context: KnowledgeMcpContext): McpServer {
  const { request, auth, searchIndexId, organizationId } = context
  const scope: ResourceScope = { kind: 'organization', organizationId }
  const principal = auth.principal
  const server = new McpServer({ name: 'Sim Search', version: '1.0.0' })

  async function execute(
    toolName: SearchMcpActivityInput['toolName'],
    operation: ApplicationOperation,
    toolSignal: AbortSignal,
    run: (registry: ResolvedSecretTraceRegistry, signal: AbortSignal) => Promise<CallToolResult>
  ): Promise<CallToolResult> {
    const startedAt = performance.now()
    const signal = AbortSignal.any([request.signal, toolSignal])
    let outcome: SearchMcpActivityInput['outcome'] = 'error'
    try {
      signal.throwIfAborted()
      const limited = await v2RateLimits.publicApi.enforce(request, auth, operation)
      signal.throwIfAborted()
      if (limited) {
        outcome = 'rate_limited'
        const retryAfter = parseRetryAfter(
          limited.headers.get('Retry-After'),
          Number.MAX_SAFE_INTEGER
        )
        return toolError(
          retryAfter === null
            ? 'API rate limit exceeded. Please try again later.'
            : `API rate limit exceeded. Retry in ${Math.ceil(retryAfter / 1000)} seconds.`
        )
      }
      const result = await run(new ResolvedSecretTraceRegistry(), signal)
      outcome = signal.aborted ? 'cancelled' : result.isError ? 'error' : 'success'
      return result
    } catch (error) {
      if (signal.aborted) outcome = 'cancelled'
      const response = v2CaughtOrchestrationError(error)
      if (response) {
        const body: unknown = await response.json()
        if (
          isPlainRecord(body) &&
          isPlainRecord(body.error) &&
          typeof body.error.message === 'string'
        ) {
          return toolError(body.error.message)
        }
      }
      logger.error('Knowledge MCP operation failed', { operation: operation.id, error })
      return toolError('Unable to complete this operation. Please try again.')
    } finally {
      const activity: SearchMcpActivityInput = {
        toolName,
        organizationId,
        userId: resolvePrincipalSubjectUserId(principal) ?? null,
        authKind: principal.kind,
        oauthClientId: principal.kind === 'oauth_access_token' ? principal.clientId : null,
        clientName: principal.kind === 'oauth_access_token' ? (principal.clientName ?? null) : null,
        outcome,
        durationMs: Math.round(performance.now() - startedAt),
        createdAt: new Date(),
      }
      logger.info('Knowledge MCP tool completed', {
        toolName,
        operation: operation.id,
        organizationId,
        userId: activity.userId,
        outcome,
        durationMs: activity.durationMs,
      })
      afterResponse(() => recordOrganizationSearchMcpActivity(activity))
    }
  }

  server.registerTool(
    'search',
    {
      title: 'Search',
      description: isLiveEnterpriseSearchEnabled
        ? 'Search this organization’s sources through their live APIs, within your access and the admin’s source settings. Use source and date filters to narrow results, or nativeQueries for provider queries and pagination. Inspect live.accounts for provider status and continuation cursors, and live.guidance for query syntax. Results are candidates, not proof of complete coverage. Use read_document with the exact returned documentId for context and cite citationUrl when available.'
        : 'Search accessible passages in this organization’s Search index. Use source (for example, jira), modifiedAfter (an ISO timestamp), or documentIds to narrow results. Results are candidates; score is similarity, not answer confidence. Use read_document for context and cite citationUrl.',
      inputSchema: isLiveEnterpriseSearchEnabled ? liveSearchMcpSchema : searchMcpSchema,
      annotations: READ_ONLY,
    },
    async (input: unknown, extra: { signal: AbortSignal }) =>
      execute('search', knowledgeOperations.search, extra.signal, async (registry, signal) => {
        if (isLiveEnterpriseSearchEnabled) {
          const { query, topK, nativeQueries, ...filters } = liveSearchMcpSchema.parse(input)
          const result = await searchLiveKnowledge.execute({
            principal,
            input: {
              organizationId,
              query,
              topK,
              nativeQueries,
              filters,
              resultSecretRegistry: registry,
              signal,
            },
            request,
          })
          return projectResult(
            {
              results: result.results.map((row) => ({
                documentId: row.documentId,
                title: row.documentName,
                sourceUrl: row.sourceUrl,
                citationId: liveCitationId(row.documentId),
                citationUrl: row.sourceUrl,
                sourceModifiedAt: row.sourceModifiedAt ?? null,
                sourceDate: row.sourceDate,
                sourceContainerName: row.sourceContainerName,
                sourceContainerUrl: row.sourceContainerUrl,
                connectorType: row.connectorType,
                content: row.content,
                chunkIndex: row.chunkIndex,
              })),
              retrieval: result.retrieval,
              live: result.live,
            },
            registry
          )
        }
        const { query, topK, ...filters } = searchMcpSchema.parse(input)
        if (!searchIndexId) {
          return projectResult(
            {
              results: [],
              message: 'No Search index is configured. Ask an admin to connect a source.',
            },
            registry
          )
        }
        const result = await searchKnowledge.execute({
          principal,
          input: {
            organizationId,
            knowledgeBaseIds: [searchIndexId],
            query,
            topK,
            filters,
            resultSecretRegistry: registry,
            surface: 'mcp',
            signal,
          },
          request,
        })
        return projectResult(
          {
            results: result.results.map((row) => ({
              documentId: row.documentId,
              title: row.documentName,
              sourceUrl: row.sourceUrl,
              ...createKnowledgeDocumentCitation({
                scope,
                knowledgeBaseId: row.knowledgeBaseId,
                documentId: row.documentId,
                sourceUrl: row.sourceUrl,
                baseUrl: getBaseUrl(),
              }),
              sourceModifiedAt: row.sourceModifiedAt?.toISOString() ?? null,
              connectorType: row.connectorType,
              content: row.content,
              chunkIndex: row.chunkIndex,
              score: row.similarity,
            })),
          },
          result.resultSecretRegistry ?? registry
        )
      })
  )
  server.registerTool(
    'read_document',
    {
      title: 'Read document',
      description: isLiveEnterpriseSearchEnabled
        ? 'Read a live document using the exact documentId returned by search. Access and the admin’s source settings are checked again on every read. When hasMore is true, pass next.startChunkIndex and next.startOffset with the same documentId to continue. Cite citationUrl when available.'
        : 'Read an indexed document by documentId from search or its original URL. URLs must match an accessible indexed source; this tool does not browse the web. Set aroundChunkIndex to a search hit’s chunkIndex for nearby context, or use offset for sequential pages. When pagination.hasMore is true, continue with pagination.offset + pagination.limit. Cite citationUrl. Documents still indexing return metadata only.',
      inputSchema: isLiveEnterpriseSearchEnabled
        ? readLiveDocumentMcpSchema
        : readDocumentMcpSchema,
      annotations: READ_ONLY,
    },
    async (raw: unknown, extra: { signal: AbortSignal }) =>
      execute(
        'read_document',
        knowledgeOperations.readDocument,
        extra.signal,
        async (registry, signal) => {
          if (isLiveEnterpriseSearchEnabled) {
            const input = readLiveDocumentMcpSchema.parse(raw)
            const result = await readLiveDocument.execute({
              principal,
              input: { ...input, organizationId, resultSecretRegistry: registry, signal },
              request,
            })
            const {
              knowledgeBaseId: _knowledgeBaseId,
              knowledgeBaseName: _name,
              ...document
            } = result
            return projectResult(
              {
                ...document,
                title: result.documentName,
                citationId: liveCitationId(result.documentId),
                citationUrl: result.sourceUrl,
              },
              registry
            )
          }
          const input = readDocumentMcpSchema.parse(raw)
          if (!input.url && !input.documentId) return toolError('Document not found')
          const result = await readIndexedKnowledgeDocument.execute({
            principal,
            input: {
              organizationId,
              target: input.url
                ? { kind: 'url', url: input.url }
                : { kind: 'id', documentId: input.documentId! },
              limit: input.limit,
              offset: input.offset,
              aroundChunkIndex: input.aroundChunkIndex,
              resultSecretRegistry: registry,
              signal,
            },
            request,
          })
          const { knowledgeBaseId, ...document } = result
          return projectResult(
            {
              ...document,
              ...createKnowledgeDocumentCitation({
                scope,
                knowledgeBaseId,
                documentId: result.documentId,
                sourceUrl: result.sourceUrl,
                baseUrl: getBaseUrl(),
              }),
            },
            registry
          )
        }
      )
  )

  server.registerTool(
    'chat',
    {
      title: 'Chat',
      description:
        'Ask the Sim Assistant to answer a question using your accessible organization sources. Returns an answer with citations and starts a new private conversation. Use source, modifiedAfter, or documentIds to narrow the evidence. No web search or source changes. Use search instead when you need raw passages.',
      inputSchema: chatSearchMcpSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ query, ...filters }, extra) =>
      execute('chat', organizationSearchChatOperation, extra.signal, async (registry, signal) => {
        const { organizationSearchChat } = await import('@/lib/knowledge/application/chat')
        const result = await organizationSearchChat.execute({
          principal,
          input: { organizationId, query, filters, resultSecretRegistry: registry, signal },
        })
        return projectResult(result, registry)
      })
  )

  return server
}
