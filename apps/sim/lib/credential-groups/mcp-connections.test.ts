/**
 * @vitest-environment node
 */
import { dbChainMockFns, hasMockCondition, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listCredentialGroupMcpConnectionReferences } from '@/lib/credential-groups/mcp-connections'

describe('listCredentialGroupMcpConnectionReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns MCP credential IDs and tool names without secret material', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'mcp-cg-connection-1',
        email: 'person@example.com',
        displayName: 'Fireflies',
        mcpServerId: 'mcp-server-1',
        mcpServerName: 'Fireflies',
        hasToolSnapshot: true,
        toolNames: ['list_transcripts', 'get_transcript'],
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    ])

    const result = await listCredentialGroupMcpConnectionReferences({
      workspaceId: 'workspace-1',
      credentialGroupId: 'group-1',
      limit: 50,
    })

    expect(result).toEqual({
      mcpConnections: [
        {
          credentialId: 'mcp-cg-connection-1',
          email: 'person@example.com',
          displayName: 'Fireflies',
          mcpServerId: 'mcp-server-1',
          mcpServerName: 'Fireflies',
          toolNames: ['list_transcripts', 'get_transcript'],
        },
      ],
      nextCursor: null,
    })
  })

  it('applies email and root MCP server filters inside the credential group scope', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await listCredentialGroupMcpConnectionReferences({
      workspaceId: 'workspace-1',
      credentialGroupId: 'group-1',
      email: 'person@example.com',
      mcpServerId: 'mcp-server-1',
      limit: 50,
    })

    const where = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(
        where,
        (condition) => condition.type === 'eq' && condition.right === 'person@example.com'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (condition) => condition.type === 'eq' && condition.right === 'mcp-server-1'
      )
    ).toBe(true)
  })

  it('fails fast when an active connection has no tool snapshot', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'mcp-cg-connection-1',
        email: 'person@example.com',
        displayName: 'Fireflies',
        mcpServerId: 'mcp-server-1',
        mcpServerName: 'Fireflies',
        hasToolSnapshot: false,
        toolNames: [],
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    ])

    await expect(
      listCredentialGroupMcpConnectionReferences({
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        limit: 50,
      })
    ).rejects.toThrow('Managed MCP connection mcp-cg-connection-1 has no tool snapshot')
  })
})
