import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import {
  knowledgeSearchUseCaseMock,
  knowledgeSearchUseCaseMockFns,
} from '@sim/testing/mocks/knowledge-search-use-case.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  liveSearch: vi.fn(),
  liveRead: vi.fn(),
  indexedRead: vi.fn(),
}))
vi.mock('@/lib/core/utils/after-response', () => ({ afterResponse: vi.fn() }))
vi.mock('@/lib/knowledge/mcp/activity', () => ({ recordOrganizationSearchMcpActivity: vi.fn() }))
vi.mock('@/lib/api/server/routes/v2-json-route', () => ({
  v2RateLimits: { publicApi: { enforce: vi.fn().mockResolvedValue(null) } },
}))
vi.mock('@/lib/knowledge/application/search', () => knowledgeSearchUseCaseMock)
vi.mock('@/lib/knowledge/application/read-indexed-document', () => ({
  readIndexedKnowledgeDocument: { execute: hoisted.indexedRead },
}))
vi.mock('@/lib/sim-search/live/application', () => ({
  searchLiveKnowledge: { execute: hoisted.liveSearch },
  readLiveDocument: { execute: hoisted.liveRead },
}))

import { createKnowledgeMcpServer } from '@/lib/knowledge/mcp/server'

const mocks = {
  ...hoisted,
  indexedSearch: knowledgeSearchUseCaseMockFns.mockSearchKnowledgeExecute,
}

urlsMockFns.mockGetBaseUrl.mockReturnValue('http://localhost')

describe('Search MCP protocol', () => {
  beforeEach(() => {
    resetEnvFlagsMock()
  })

  it.each([true, false])(
    'lists and calls the selected backend through the SDK (live: %s)',
    async (live) => {
      setEnvFlags({ isLiveEnterpriseSearchEnabled: live })
      const documentId = live ? `live:${'a'.repeat(500)}` : 'doc-1'
      const row = {
        documentId,
        knowledgeBaseId: live ? '' : 'index-1',
        documentName: 'Release notes',
        sourceUrl: 'https://example.com/notes',
        connectorType: 'google_drive',
        content: 'Evidence',
        chunkIndex: 0,
        similarity: 0.5,
      }
      mocks.liveSearch.mockResolvedValue({
        results: [row],
        live: { backend: 'live', accounts: [], guidance: '' },
      })
      mocks.indexedSearch.mockResolvedValue({ results: [row] })
      mocks.liveRead.mockResolvedValue({
        ...row,
        knowledgeBaseName: 'Drive',
        chunks: [{ chunkIndex: 0, content: 'Read evidence' }],
        hasMore: false,
        next: null,
      })
      mocks.indexedRead.mockResolvedValue({
        ...row,
        title: row.documentName,
        chunks: [{ chunkIndex: 0, content: 'Read evidence' }],
      })

      const server = createKnowledgeMcpServer({
        organizationId: 'org-1',
        searchIndexId: live ? null : 'index-1',
        request: new NextRequest('http://localhost/api/mcp/search/organizations/org-1'),
        auth: {
          principal: createPersonalApiKeyPrincipal(),
          keyType: 'personal',
          keyExpiresAt: null,
          rateLimitSubjectIds: ['user-1'],
          rateLimitSubscription: null,
        },
      })
      const client = new Client({ name: 'Search test', version: '1.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      try {
        await server.connect(serverTransport)
        await client.connect(clientTransport)
        const { tools } = await client.listTools()
        expect(tools.map((tool) => tool.name)).toEqual(['search', 'read_document', 'chat'])
        const searchSchema = tools.find((tool) => tool.name === 'search')?.inputSchema
        const readSchema = tools.find((tool) => tool.name === 'read_document')?.inputSchema
        if (live) {
          expect(searchSchema?.properties).toHaveProperty('nativeQueries')
          expect(readSchema?.properties).toHaveProperty('startOffset')
          expect(readSchema?.properties).not.toHaveProperty('url')
        } else {
          expect(searchSchema?.properties).not.toHaveProperty('nativeQueries')
          expect(readSchema?.properties).toHaveProperty('offset')
          expect(readSchema?.properties).toHaveProperty('url')
        }
        const search = await client.callTool({ name: 'search', arguments: { query: 'release' } })
        expect(search.isError).not.toBe(true)
        expect(search.content).toEqual([
          { type: 'text', text: expect.stringContaining(documentId) },
        ])
        const read = await client.callTool({ name: 'read_document', arguments: { documentId } })
        expect(read.isError).not.toBe(true)
        expect(read.content).toEqual([
          { type: 'text', text: expect.stringContaining('Read evidence') },
        ])
        expect(live ? mocks.liveSearch : mocks.indexedSearch).toHaveBeenCalledOnce()
        expect(live ? mocks.liveRead : mocks.indexedRead).toHaveBeenCalledOnce()
        expect(live ? mocks.indexedSearch : mocks.liveSearch).not.toHaveBeenCalled()
        expect(live ? mocks.indexedRead : mocks.liveRead).not.toHaveBeenCalled()
      } finally {
        await client.close()
        await server.close()
      }
    }
  )
})
