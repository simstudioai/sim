import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import type { NextRequest } from 'next/server'
import {
  listDocumentChunksMcpSchema,
  readDocumentMcpSchema,
  searchDocumentsMcpSchema,
} from '@/lib/api/contracts/knowledge/mcp'
import type { V2ApiKeyAuthContext } from '@/lib/api/server/routes/v2-api-key-auth'
import { v2RateLimits } from '@/lib/api/server/routes/v2-json-route'
import type { ApplicationOperation } from '@/lib/core/application'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import {
  createKnowledgeDocumentSourceValue,
  importKnowledgePersistedResponseSecretProvenance,
} from '@/lib/knowledge/secret-provenance'
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

interface KnowledgeMcpContext extends ResourceOwner {
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
  const { request, auth, searchIndexId } = context
  const scope = resourceScopeFromOwner(context)
  const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : undefined
  const organizationId = scope.kind === 'organization' ? scope.organizationId : undefined
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
    'search_documents',
    {
      description:
        'Search documents you can access. Defaults to this Search index; optional knowledgeBaseIds restrict search to those knowledge bases. Use returned knowledgeBaseId and documentId to read a document or its chunks.',
      inputSchema: searchDocumentsMcpSchema,
      annotations: READ_ONLY,
    },
    async ({ query, topK, knowledgeBaseIds }, extra) =>
      execute(knowledgeOperations.search, async (registry) => {
        if (organizationId && knowledgeBaseIds?.some((id) => id !== searchIndexId))
          return toolError('Knowledge base not found')
        const ids = knowledgeBaseIds ?? (searchIndexId ? [searchIndexId] : [])
        if (ids.length === 0) {
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
            workspaceId,
            organizationId,
            knowledgeBaseIds: ids,
            query,
            topK,
            resultSecretRegistry: registry,
            surface: 'mcp',
            signal: AbortSignal.any([request.signal, extra.signal]),
          },
          request,
        })
        return projectResult(
          {
            results: result.results.map((row) => ({
              knowledgeBaseId: row.knowledgeBaseId,
              documentId: row.documentId,
              title: row.documentName,
              sourceUrl: row.sourceUrl,
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
      description:
        'Read an accessible document’s title and source metadata. Use list_document_chunks for its indexed text.',
      inputSchema: readDocumentMcpSchema,
      annotations: READ_ONLY,
    },
    async (input) =>
      execute(knowledgeOperations.readDocument, async (registry) => {
        if (organizationId && input.knowledgeBaseId !== searchIndexId)
          return toolError('Document not found')
        const result = await readKnowledgeDocument.execute({
          principal,
          input: {
            ...input,
            assertedWorkspaceId: workspaceId,
            assertedOrganizationId: organizationId,
            requireEnabledDocument: true,
          },
          request,
        })
        const doc = result.document
        const value = {
          knowledgeBaseId: input.knowledgeBaseId,
          documentId: doc.id,
          title: doc.filename,
          sourceUrl: doc.sourceUrl,
          sourceModifiedAt: doc.sourceModifiedAt?.toISOString() ?? null,
          connectorType: doc.connectorType,
          processingStatus: doc.processingStatus,
        }
        await importKnowledgePersistedResponseSecretProvenance({
          registry,
          documents: [{ id: doc.id, source: createKnowledgeDocumentSourceValue(doc), value }],
          workspaceId,
          actorUserId: resolvePrincipalSubjectUserId(principal) ?? undefined,
        })
        return projectResult(value, registry)
      })
  )

  server.registerTool(
    'list_document_chunks',
    {
      description:
        'Read an accessible document’s indexed text in chunk order. Returns enabled chunks only; use pagination.hasMore and offset + limit for the next page.',
      inputSchema: listDocumentChunksMcpSchema,
      annotations: READ_ONLY,
    },
    async (input) =>
      execute(knowledgeOperations.listChunks, async (registry) => {
        if (organizationId && input.knowledgeBaseId !== searchIndexId)
          return toolError('Document not found')
        const result = await listKnowledgeChunks.execute({
          principal,
          input: {
            ...input,
            assertedWorkspaceId: workspaceId,
            assertedOrganizationId: organizationId,
            requireEnabledDocument: true,
            enabled: 'true',
            sortBy: 'chunkIndex',
            sortOrder: 'asc',
          },
          request,
        })
        const chunks = result.chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
        }))
        await importKnowledgePersistedResponseSecretProvenance({
          registry,
          chunks: chunks.map((chunk) => ({ ...chunk, documentId: input.documentId, value: chunk })),
          workspaceId,
          actorUserId: resolvePrincipalSubjectUserId(principal) ?? undefined,
        })
        return projectResult(
          {
            knowledgeBaseId: input.knowledgeBaseId,
            documentId: input.documentId,
            chunks,
            pagination: result.pagination,
          },
          registry
        )
      })
  )

  return server
}
