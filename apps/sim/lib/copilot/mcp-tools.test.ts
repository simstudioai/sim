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

import { buildSelectedMcpToolSchemas, buildTaggedMcpToolSchemas } from '@/lib/copilot/mcp-tools'

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

  it('reports tagged-server discovery provenance without placing it in tool schemas', async () => {
    const provenance = {
      version: 1,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: 'user-1', workspaceId: 'ws-1' },
    }
    discoverServerTools.mockImplementationOnce(
      async (
        _userId: string,
        _serverId: string,
        _workspaceId: string,
        _forceRefresh: boolean,
        report: (value: unknown) => void
      ) => {
        report(provenance)
        return [
          {
            serverId: 'mcp-server-1',
            name: 'search',
            description: 'Search docs',
            inputSchema: { type: 'object' },
          },
        ]
      }
    )
    const recordProvenance = vi.fn()

    const tools = await buildTaggedMcpToolSchemas(
      'user-1',
      'ws-1',
      ['mcp-server-1'],
      recordProvenance
    )

    expect(discoverServerTools).toHaveBeenCalledWith(
      'user-1',
      'mcp-server-1',
      'ws-1',
      false,
      expect.any(Function)
    )
    expect(recordProvenance).toHaveBeenCalledWith(provenance)
    expect(JSON.stringify(tools)).not.toContain('encrypted-token')
    expect(JSON.stringify(tools)).not.toContain('resolvedSecretTraceProvenance')
  })

  it('reports incomplete provenance when tagged-server discovery returns no report', async () => {
    discoverServerTools.mockResolvedValue([])
    const recordProvenance = vi.fn()

    await buildTaggedMcpToolSchemas('user-1', 'ws-1', ['mcp-server-1'], recordProvenance)

    expect(recordProvenance).toHaveBeenCalledWith({
      version: 1,
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'ws-1' },
    })
  })

  it('uses a selected block tool cached schema without discovering the server', async () => {
    const recordProvenance = vi.fn()
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
      recordProvenance
    )

    expect(discoverServerTools).not.toHaveBeenCalled()
    expect(recordProvenance).not.toHaveBeenCalled()
    expect(tools[0]).toMatchObject({
      name: 'mcp-server-1-search',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    })
  })

  it('reports provenance from selected tools that require server discovery', async () => {
    const provenance = {
      version: 1,
      complete: true,
      entries: [{ name: 'MCP_TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: 'user-1', workspaceId: 'ws-1' },
    }
    discoverServerTools.mockImplementationOnce(
      async (
        _userId: string,
        _serverId: string,
        _workspaceId: string,
        _forceRefresh: boolean,
        report: (value: unknown) => void
      ) => {
        report(provenance)
        return [
          {
            serverId: 'mcp-server-1',
            name: 'search',
            inputSchema: { type: 'object' },
          },
        ]
      }
    )
    const recordProvenance = vi.fn()

    const tools = await buildSelectedMcpToolSchemas(
      'user-1',
      'ws-1',
      [
        {
          type: 'mcp',
          params: { serverId: 'mcp-server-1', toolName: 'search' },
        },
      ],
      recordProvenance
    )

    expect(recordProvenance).toHaveBeenCalledWith(provenance)
    expect(tools[0]).toMatchObject({ name: 'mcp-server-1-search' })
  })
})
