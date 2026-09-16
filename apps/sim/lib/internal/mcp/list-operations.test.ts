/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { discover } = vi.hoisted(() => ({ discover: vi.fn() }))
vi.mock('@/lib/internal/mcp/discover-tools', () => ({ discoverMcpServerToolsAsExecutor: discover }))

import { listMcpOperations } from '@/lib/internal/mcp/list-operations'

const context = { workflowId: 'workflow-1', workspaceId: 'workspace-1', mcpBlockId: 'block-1' }
const call = {
  toolId: 'mcp_list_operations',
  headers: new Headers(),
  requestId: 'request-1',
  context,
}

describe('List MCP operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    discover.mockResolvedValue(
      ['write', 'read', 'read_more'].map((name) => ({
        name,
        description: `Operation ${name}`,
        serverId: 'connection-1',
        canonicalServerId: 'server-1',
        inputSchema: { type: 'object' },
      }))
    )
  })

  it('returns bounded, sorted authorized metadata with a next-page cursor', async () => {
    const first = await listMcpOperations({
      ...call,
      input: { server: 'connection-1', search: 'read', limit: 1 },
    })
    expect(await first.json()).toEqual({
      success: true,
      output: {
        serverId: 'connection-1',
        operations: [
          {
            name: 'read',
            description: 'Operation read',
            inputSchema: { type: 'object' },
          },
        ],
        hasMore: true,
        nextCursor: 'read',
      },
    })
    const next = await listMcpOperations({
      ...call,
      input: { server: 'server-1', search: 'read', limit: 1, cursor: 'read' },
    })
    expect(await next.json()).toMatchObject({
      output: { operations: [{ name: 'read_more' }], hasMore: false, nextCursor: null },
    })
    expect(discover.mock.calls[0][0]).toMatchObject({
      context,
      serverId: 'connection-1',
    })
  })

  it('allows an empty authorized list and propagates verification failures', async () => {
    discover.mockResolvedValueOnce([])
    expect(
      await (await listMcpOperations({ ...call, input: { server: 'server-1' } })).json()
    ).toMatchObject({ output: { operations: [], hasMore: false, nextCursor: null } })
    discover.mockRejectedValueOnce(new Error('policy cannot be verified'))
    await expect(listMcpOperations({ ...call, input: { server: 'server-1' } })).rejects.toThrow(
      'policy cannot be verified'
    )
  })

  it.each([0, 101, -1, 1.5, '2'])(
    'rejects invalid page size %j before discovery',
    async (limit) => {
      await expect(
        listMcpOperations({ ...call, input: { server: 'server-1', limit } })
      ).rejects.toThrow('page size')
      expect(discover).not.toHaveBeenCalled()
    }
  )

  it('rejects an empty resolved server without selecting a credential', async () => {
    await expect(listMcpOperations({ ...call, input: { server: '' } })).rejects.toThrow(
      'MCP server is required'
    )
    expect(discover).not.toHaveBeenCalled()
  })
})
