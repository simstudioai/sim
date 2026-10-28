import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { parseRetryAfter } from '@sim/utils/retry'
import type { NextRequest } from 'next/server'
import {
  chatSearchMcpSchema,
  liveSearchMcpDefaultTopK,
  liveSearchMcpSchema,
  readLiveDocumentMcpSchema,
} from '@/lib/api/contracts/knowledge/mcp'
import type { V2ApiKeyAuthContext } from '@/lib/api/server/routes/v2-api-key-auth'
import { v2RateLimits } from '@/lib/api/server/routes/v2-json-route'
import { afterResponse } from '@/lib/core/utils/after-response'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { organizationSearchChatOperation } from '@/lib/knowledge/application/chat-operations'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  recordOrganizationSearchMcpActivity,
  type SearchMcpActivityInput,
} from '@/lib/knowledge/mcp/activity'
import {
  KNOWLEDGE_MCP_READ_ONLY,
  type KnowledgeMcpToolRunner,
  projectResult,
} from '@/lib/knowledge/mcp/tool-runner'
import { liveCitationId } from '@/lib/knowledge/search/citation'
import { toolError } from '@/lib/mcp/tool-result'
import { readLiveDocument, searchLiveKnowledge } from '@/lib/sim-search/live/application'
import { LiveReadError } from '@/lib/sim-search/live/read-error'
import { v2CaughtOrchestrationError } from '@/app/api/v2/lib/response'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('KnowledgeMcp')
/** Provider reads one read_document call runs at once, however many documents it names. */
const READ_DOCUMENT_CONCURRENCY = 5

/** The message a caller may see for an expected failure; undefined for an internal error. */
async function callerErrorMessage(error: unknown): Promise<string | undefined> {
  if (error instanceof LiveReadError) return error.message
  const response = v2CaughtOrchestrationError(error)
  if (!response) return undefined
  const body: unknown = await response.json()
  return isPlainRecord(body) && isPlainRecord(body.error) && typeof body.error.message === 'string'
    ? body.error.message
    : undefined
}

/** One read_document result in the shape the tool returns it. */
function projectReadResult(result: Awaited<ReturnType<typeof readLiveDocument.execute>>) {
  const { knowledgeBaseId: _knowledgeBaseId, knowledgeBaseName: _name, ...document } = result
  return {
    ...document,
    title: result.documentName,
    citationId: liveCitationId(result.documentId),
    citationUrl: result.sourceUrl,
  }
}

interface KnowledgeMcpContext {
  organizationId: string
  request: NextRequest
  auth: V2ApiKeyAuthContext
}

/** A request owns its server; no credential or principal survives into another HTTP request. */
export function createKnowledgeMcpServer(context: KnowledgeMcpContext): McpServer {
  const { request, auth, organizationId } = context
  const principal = auth.principal
  const server = new McpServer({ name: 'Sim Search', version: '1.0.0' })

  const execute: KnowledgeMcpToolRunner = async (toolName, operation, toolSignal, run, cost) => {
    const startedAt = performance.now()
    const signal = AbortSignal.any([request.signal, toolSignal])
    let outcome: SearchMcpActivityInput['outcome'] = 'error'
    try {
      signal.throwIfAborted()
      const limited = await v2RateLimits.publicApi.enforce(request, auth, operation, cost)
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
      const message = await callerErrorMessage(error)
      if (message) return toolError(message)
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
      description:
        'Search this organization’s sources through their live APIs, within your access and the admin’s source settings. Use source and date filters to narrow results, or nativeQueries for provider queries and pagination. Results carry a passage around their match where the source provides text. Inspect live.accounts for provider status and continuation cursors, and live.guidance for query syntax. Results are candidates, not proof of complete coverage. When a passage does not answer the question, use read_document with the exact returned documentId, and cite citationUrl when available.',
      inputSchema: liveSearchMcpSchema,
      annotations: KNOWLEDGE_MCP_READ_ONLY,
    },
    async (input: unknown, extra: { signal: AbortSignal }) =>
      execute('search', knowledgeOperations.search, extra.signal, async (registry, signal) => {
        const parsed = liveSearchMcpSchema.parse(input)
        const { query, topK, nativeQueries, ...filters } = parsed
        const result = await searchLiveKnowledge.execute({
          principal,
          input: {
            organizationId,
            query,
            topK: topK ?? liveSearchMcpDefaultTopK(parsed),
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
      })
  )
  server.registerTool(
    'read_document',
    {
      title: 'Read document',
      description:
        'Read live documents using the exact document IDs returned by search: documentId for one, or documentIds to read several in one call rather than one call each. Access and the admin’s source settings are checked again on every read. When a document’s hasMore is true, pass its next.startChunkIndex and next.startOffset with the same documentId to continue. Cite citationUrl when available.',
      inputSchema: readLiveDocumentMcpSchema,
      annotations: KNOWLEDGE_MCP_READ_ONLY,
    },
    async (raw: unknown, extra: { signal: AbortSignal }) => {
      const parsed = readLiveDocumentMcpSchema.safeParse(raw)
      const batch =
        parsed.success && parsed.data.documentIds ? [...new Set(parsed.data.documentIds)] : []
      return execute(
        'read_document',
        knowledgeOperations.readDocument,
        extra.signal,
        async (registry, signal) => {
          if (!parsed.success) throw parsed.error
          const { documentId, documentIds: _documentIds, ...options } = parsed.data
          const read = (id: string) =>
            readLiveDocument.execute({
              principal,
              input: {
                ...options,
                documentId: id,
                organizationId,
                resultSecretRegistry: registry,
                signal,
              },
              request,
            })
          if (documentId) return projectResult(projectReadResult(await read(documentId)), registry)
          /** One unreadable document leaves the others; each failure is reported in its place. */
          const documents = await mapWithConcurrency(
            batch,
            READ_DOCUMENT_CONCURRENCY,
            async (id) => {
              try {
                return projectReadResult(await read(id))
              } catch (error) {
                signal.throwIfAborted()
                const message = await callerErrorMessage(error)
                if (!message)
                  logger.error('Knowledge MCP batched read failed', {
                    operation: knowledgeOperations.readDocument.id,
                    error,
                  })
                return {
                  documentId: id,
                  error: message ?? 'Unable to read this document. Please try again.',
                }
              }
            }
          )
          return projectResult({ documents }, registry)
        },
        Math.max(1, batch.length)
      )
    }
  )

  server.registerTool(
    'chat',
    {
      title: 'Chat',
      description:
        'Ask the Sim Assistant to research a question in your accessible organization sources and write a cited answer. It runs its own multi-step search, so it usually takes 30 to 60 seconds and returns a synthesized answer rather than the sources. To answer a question yourself, use search and read_document, which return sources in seconds; use chat only when the user asks for the Sim Assistant’s answer. Starts a new private conversation. Use source, modifiedAfter, or documentIds to narrow the evidence. No web search or source changes.',
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
