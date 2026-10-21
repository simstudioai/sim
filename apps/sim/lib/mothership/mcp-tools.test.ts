import { mcpUseCasesMock, mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
import { describe, expect, it, vi } from 'vitest'

const { discoverServerTools } = vi.hoisted(() => ({
  discoverServerTools: vi.fn(),
}))

vi.mock('@/lib/internal/mcp/discover-tools', () => ({
  discoverMcpServerToolsAsExecutor: discoverServerTools,
}))
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)

import { buildMcpToolSchemas } from '@/lib/mothership/mcp-tools'

mcpUseCasesMockFns.mockDiscoverMcpServerToolsUseCase.mockImplementation(async (args: unknown) => ({
  tools: await discoverServerTools(args),
}))

describe('mothership MCP tool schemas', () => {
  it('discovers tools only for explicitly tagged servers', async () => {
    discoverServerTools.mockResolvedValue([
      {
        serverId: 'mcp-server-1',
        serverName: 'Docs',
        name: 'search',
        description: 'Search docs',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ])

    const { tools, failures } = await buildMcpToolSchemas('user-1', 'ws-1', {
      complete: ['mcp-server-1'],
    })

    expect(discoverServerTools).toHaveBeenCalledTimes(1)
    expect(discoverServerTools).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ serverId: 'mcp-server-1', workspaceId: 'ws-1' }),
      })
    )
    expect(tools).toEqual([
      {
        name: 'mcp-server-1-search',
        description: 'Search docs',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
        service: 'mcp:mcp-server-1',
      },
    ])
    expect(failures).toEqual([])
  })

  it('reports a failing or tool-less server without discarding the other servers', async () => {
    discoverServerTools.mockImplementation(async ({ input: { serverId } }) => {
      if (serverId === 'mcp-down') throw new Error('connect ECONNREFUSED')
      if (serverId === 'mcp-empty') return []
      return [{ serverId, name: 'search', inputSchema: { type: 'object' } }]
    })

    const discovery = await buildMcpToolSchemas('user-1', 'ws-1', {
      complete: ['mcp-down', 'mcp-server-1', 'mcp-empty'],
    })

    expect(discovery.tools.map((tool) => tool.name)).toEqual(['mcp-server-1-search'])
    expect(discovery.failures.map(({ serverId, error }) => [serverId, error.message])).toEqual([
      ['mcp-down', 'connect ECONNREFUSED'],
      ['mcp-empty', 'No permitted MCP operations are available for mcp-empty'],
    ])
  })

  it('treats a best-effort server with no permitted operations as contributing nothing', async () => {
    discoverServerTools.mockImplementation(async ({ input: { serverId } }) =>
      serverId === 'mcp-empty' ? [] : [{ serverId, name: 'search', inputSchema: {} }]
    )

    const discovery = await buildMcpToolSchemas('user-1', 'ws-1', {
      complete: [],
      bestEffort: ['mcp-empty', 'mcp-server-1'],
    })

    expect(discovery.tools.map((tool) => tool.name)).toEqual(['mcp-server-1-search'])
    expect(discovery.failures).toEqual([])
  })
})
