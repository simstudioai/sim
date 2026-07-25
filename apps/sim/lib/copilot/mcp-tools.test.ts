/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { discoverServerTools, validateMcpToolsAllowed } = vi.hoisted(() => ({
  discoverServerTools: vi.fn(),
  validateMcpToolsAllowed: vi.fn(),
}))

vi.mock('@/lib/mcp/service', () => ({ mcpService: { discoverServerTools } }))
vi.mock('@/ee/access-control/utils/permission-check', () => ({ validateMcpToolsAllowed }))

import { buildSelectedMcpToolSchemas, buildTaggedMcpToolSchemas } from './mcp-tools'

describe('mothership MCP tool schemas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateMcpToolsAllowed.mockResolvedValue(undefined)
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
    expect(discoverServerTools).toHaveBeenCalledWith('user-1', 'mcp-server-1', 'ws-1')
    expect(tools).toEqual([
      expect.objectContaining({
        name: 'mcp-server-1-search',
        defer_loading: true,
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

  it('uses a selected block tool cached schema without discovering the server', async () => {
    const tools = await buildSelectedMcpToolSchemas('user-1', 'ws-1', [
      {
        type: 'mcp',
        params: { serverId: 'mcp-server-1', toolName: 'search', serverName: 'Docs' },
        schema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ])

    expect(discoverServerTools).not.toHaveBeenCalled()
    expect(tools[0]).toMatchObject({
      name: 'mcp-server-1-search',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    })
  })
})
