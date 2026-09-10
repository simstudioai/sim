/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { discoverServerTools, assertPermissionsAllowed } = vi.hoisted(() => ({
  discoverServerTools: vi.fn(),
  assertPermissionsAllowed: vi.fn(),
}))

vi.mock('@/lib/internal/mcp/discover-tools', () => ({
  discoverMcpServerToolsAsExecutor: discoverServerTools,
}))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  discoverMcpServerToolsUseCase: {
    execute: async (args: unknown) => ({ tools: await discoverServerTools(args) }),
  },
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({ assertPermissionsAllowed }))

import { buildSelectedMcpToolSchemas, buildTaggedMcpToolSchemas } from '@/lib/copilot/mcp-tools'

describe('mothership MCP tool schemas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assertPermissionsAllowed.mockResolvedValue(undefined)
  })

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

    const tools = await buildTaggedMcpToolSchemas('user-1', 'ws-1', ['mcp-server-1'])

    expect(discoverServerTools).toHaveBeenCalledTimes(1)
    expect(discoverServerTools).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ serverId: 'mcp-server-1', workspaceId: 'ws-1' }),
      })
    )
    expect(tools).toEqual([
      expect.objectContaining({
        name: 'mcp-server-1-search',
        // Explicitly enabled by the user, so it is callable without an unlock step.
        defer_loading: false,
        executeLocally: false,
        params: expect.objectContaining({
          mothershipToolKind: 'mcp',
          mothershipToolName: 'mcp-server-1-search',
          serverId: 'mcp-server-1',
          toolName: 'search',
        }),
      }),
    ])
  })

  it('rediscovers a selected block tool even with a cached schema', async () => {
    discoverServerTools.mockResolvedValue([
      {
        serverId: 'mcp-server-1',
        name: 'search',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ])
    const tools = await buildSelectedMcpToolSchemas(
      'user-1',
      'ws-1',
      [
        {
          type: 'mcp',
          params: { serverId: 'mcp-server-1', toolName: 'search', serverName: 'Docs' },
          schema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
      { workflowId: 'workflow-1', workspaceId: 'ws-1', mcpBlockId: 'block-1' }
    )

    expect(discoverServerTools).toHaveBeenCalledOnce()
    expect(tools[0]).toMatchObject({
      name: 'mcp-server-1-search',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    })
  })

  it('discovers a selected legacy tool without a cached schema', async () => {
    discoverServerTools.mockResolvedValueOnce([
      {
        serverId: 'mcp-server-1',
        name: 'search',
        inputSchema: { type: 'object' },
      },
    ])

    const tools = await buildSelectedMcpToolSchemas(
      'user-1',
      'ws-1',
      [
        {
          type: 'mcp',
          params: { serverId: 'mcp-server-1', toolName: 'search' },
        },
      ],
      { workflowId: 'workflow-1', workspaceId: 'ws-1', mcpBlockId: 'block-1' }
    )

    expect(discoverServerTools).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'mcp-server-1', workspaceId: 'ws-1' })
    )
    expect(tools[0]).toMatchObject({ name: 'mcp-server-1-search' })
  })
})
