import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { apiServerRoutesMock } from '@sim/testing/mocks/api-server-routes.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { toArray, toRecord } from '@sim/utils/object'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  liveSearch: vi.fn(),
  liveRead: vi.fn(),
}))
vi.mock('@/lib/core/utils/after-response', () => ({ afterResponse: vi.fn() }))
vi.mock('@/lib/knowledge/mcp/activity', () => ({ recordOrganizationSearchMcpActivity: vi.fn() }))
vi.mock('@/lib/api/server/routes/v2-json-route', () => ({
  ...apiServerRoutesMock,
  v2RateLimits: { publicApi: { enforce: vi.fn().mockResolvedValue(null) } },
}))
vi.mock('@/lib/sim-search/live/application', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sim-search/live/application')>()),
  searchLiveKnowledge: { execute: hoisted.liveSearch },
  readLiveDocument: { execute: hoisted.liveRead },
}))

import { createKnowledgeMcpServer } from '@/lib/knowledge/mcp/server'

const mocks = hoisted

urlsMockFns.mockGetBaseUrl.mockReturnValue('http://localhost')

describe('Search MCP protocol', () => {
  it('lists and calls live Search through the SDK', async () => {
    const documentId = `live:${'a'.repeat(500)}`
    const row = {
      documentId,
      knowledgeBaseId: '',
      documentName: 'Release notes',
      sourceUrl: 'https://example.com/notes',
      connectorType: 'google_drive',
      content: 'Evidence',
      chunkIndex: 0,
      similarity: 0.5,
      queryIndexes: [0],
    }
    mocks.liveSearch.mockResolvedValue({
      results: [row],
      retrieval: { status: 'complete', timedOutLegs: [] },
      live: { backend: 'live', accounts: [], guidance: '' },
    })
    mocks.liveRead.mockResolvedValue({
      ...row,
      knowledgeBaseName: 'Drive',
      chunks: [{ chunkIndex: 0, content: 'Read evidence' }],
      hasMore: false,
      next: null,
    })
    const server = createKnowledgeMcpServer({
      organizationId: 'org-1',
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
      expect(searchSchema?.properties).toHaveProperty('nativeQueries')
      expect(searchSchema?.properties?.startDate).toMatchObject({ format: 'date-time' })
      expect(searchSchema?.properties?.startDate).not.toHaveProperty('pattern')
      expect(readSchema?.properties).toHaveProperty('startOffset')
      expect(readSchema?.properties).not.toHaveProperty('url')
      const search = await client.callTool({
        name: 'search',
        arguments: {
          query: 'release',
          nativeQueries: [{ provider: 'google_drive', query: "name contains 'release'" }],
        },
      })
      expect(search.isError).not.toBe(true)
      const searchContent = toRecord(toArray(search.content)[0])
      if (typeof searchContent.text !== 'string') throw new Error('Missing search payload')
      expect(JSON.parse(searchContent.text)).toMatchObject({
        results: [{ documentId, queryIndexes: [0] }],
      })
      const read = await client.callTool({
        name: 'read_document',
        arguments: { documentId, limit: 8 },
      })
      expect(read.isError).not.toBe(true)
      expect(mocks.liveRead.mock.lastCall?.[0].input).toMatchObject({
        limit: 8,
        scaledWindow: { documentsInCall: 1 },
      })
      expect(read.content).toEqual([
        { type: 'text', text: expect.stringContaining('Read evidence') },
      ])
      const batchRead = await client.callTool({
        name: 'read_document',
        arguments: { documentIds: [documentId, `${documentId}b`], limit: 8 },
      })
      expect(batchRead.isError).not.toBe(true)
      expect(mocks.liveRead.mock.lastCall?.[0].input).toMatchObject({
        limit: 8,
        scaledWindow: { documentsInCall: 2 },
      })
      const offsetless = await client.callTool({
        name: 'search',
        arguments: {
          query: 'release',
          startDate: '2026-09-28T00:00:00',
          endDate: '2026-10-08T00:00',
          modifiedAfter: '2026-09-01T08:00:00-07:00',
        },
      })
      expect(offsetless.isError).not.toBe(true)
      expect(mocks.liveSearch.mock.lastCall?.[0].input.filters).toMatchObject({
        startDate: '2026-09-28T00:00:00Z',
        endDate: '2026-10-08T00:00Z',
        modifiedAfter: '2026-09-01T08:00:00-07:00',
      })
      const notADate = await client.callTool({
        name: 'search',
        arguments: { query: 'release', startDate: '2026-09-28' },
      })
      expect(notADate.isError).toBe(true)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
