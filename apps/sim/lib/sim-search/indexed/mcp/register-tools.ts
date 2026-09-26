import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Principal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import { readDocumentMcpSchema, searchMcpSchema } from '@/lib/api/contracts/knowledge/mcp'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import {
  KNOWLEDGE_MCP_READ_ONLY,
  type KnowledgeMcpToolRunner,
  projectResult,
} from '@/lib/knowledge/mcp/tool-runner'
import { createKnowledgeDocumentCitation } from '@/lib/knowledge/search/citation'
import { toolError } from '@/lib/mcp/tool-result'
import { readIndexedKnowledgeDocument } from '@/lib/sim-search/indexed/documents/read-indexed-document'
import { assertIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'

interface IndexedKnowledgeMcpToolsContext {
  server: McpServer
  principal: Principal
  request: NextRequest
  organizationId: string
  /** The organization's search index, or null when no source is connected yet. */
  searchIndexId: string | null
  execute: KnowledgeMcpToolRunner
}

/**
 * Registers the indexed `search` and `read_document` Search MCP tools: passages ranked from the
 * organization's search index, and indexed documents read by id or source URL. Called only while
 * indexed organization search is on, and refuses otherwise; both tools run through use cases that
 * refuse a dormant search index on their own.
 */
export function registerIndexedKnowledgeMcpTools(context: IndexedKnowledgeMcpToolsContext): void {
  assertIndexedOrgSearchEnabled()
  const { server, principal, request, organizationId, searchIndexId, execute } = context
  const scope: ResourceScope = { kind: 'organization', organizationId }

  server.registerTool(
    'search',
    {
      title: 'Search',
      description:
        'Search accessible passages in this organization’s Search index. Use source (for example, jira), modifiedAfter (an ISO timestamp), or documentIds to narrow results. Results are candidates; score is similarity, not answer confidence. Use read_document for context and cite citationUrl.',
      inputSchema: searchMcpSchema,
      annotations: KNOWLEDGE_MCP_READ_ONLY,
    },
    async (input: unknown, extra: { signal: AbortSignal }) =>
      execute('search', knowledgeOperations.search, extra.signal, async (registry, signal) => {
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
      description:
        'Read an indexed document by documentId from search or its original URL. URLs must match an accessible indexed source; this tool does not browse the web. Set aroundChunkIndex to a search hit’s chunkIndex for nearby context, or use offset for sequential pages. When pagination.hasMore is true, continue with pagination.offset + pagination.limit. Cite citationUrl. Documents still indexing return metadata only.',
      inputSchema: readDocumentMcpSchema,
      annotations: KNOWLEDGE_MCP_READ_ONLY,
    },
    async (raw: unknown, extra: { signal: AbortSignal }) =>
      execute(
        'read_document',
        knowledgeOperations.readDocument,
        extra.signal,
        async (registry, signal) => {
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
}
