import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import type { NextRequest } from 'next/server'
import {
  chatSearchMcpSchema,
  readDocumentMcpSchema,
  searchMcpSchema,
} from '@/lib/api/contracts/knowledge/mcp'
import type { V2ApiKeyAuthContext } from '@/lib/api/server/routes/v2-api-key-auth'
import { v2RateLimits } from '@/lib/api/server/routes/v2-json-route'
import type { ApplicationOperation } from '@/lib/core/application'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { organizationSearchChatOperation } from '@/lib/knowledge/application/chat-operations'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readIndexedKnowledgeDocument } from '@/lib/knowledge/application/read-indexed-document'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { createKnowledgeDocumentCitation } from '@/lib/knowledge/search/citation'
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

function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
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
    operation: ApplicationOperation,
    run: (registry: ResolvedSecretTraceRegistry) => Promise<CallToolResult>
  ): Promise<CallToolResult> {
    try {
      const limited = await v2RateLimits.publicApi.enforce(request, auth, operation)
      if (limited)
        return toolError('API rate limit exceeded. Retry after the response Retry-After interval.')
      request.signal.throwIfAborted()
      return await run(new ResolvedSecretTraceRegistry())
    } catch (error) {
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
    }
  }

  server.registerTool(
    'search',
    {
      title: 'Search',
      description:
        'Search accessible passages in this organization’s Search index. Use source (for example, jira), modifiedAfter (an ISO timestamp), or documentIds to narrow results. Results are candidates; score is similarity, not answer confidence. Use read_document for context and cite citationUrl.',
      inputSchema: searchMcpSchema,
      annotations: READ_ONLY,
    },
    async ({ query, topK, ...filters }, extra) =>
      execute(knowledgeOperations.search, async (registry) => {
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
            signal: AbortSignal.any([request.signal, extra.signal]),
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
      description:
        'Read an indexed document by documentId from search or its original URL. URLs must match an accessible indexed source; this tool does not browse the web. Set aroundChunkIndex to a search hit’s chunkIndex for nearby context, or use offset for sequential pages. When pagination.hasMore is true, continue with pagination.offset + pagination.limit. Cite citationUrl. Documents still indexing return metadata only.',
      inputSchema: readDocumentMcpSchema,
      annotations: READ_ONLY,
    },
    async (input, extra) =>
      execute(knowledgeOperations.readDocument, async (registry) => {
        const signal = AbortSignal.any([request.signal, extra.signal])
        signal.throwIfAborted()
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
      })
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
      execute(organizationSearchChatOperation, async (registry) => {
        const signal = AbortSignal.any([request.signal, extra.signal])
        signal.throwIfAborted()
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
