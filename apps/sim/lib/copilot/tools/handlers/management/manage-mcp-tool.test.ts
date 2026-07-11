/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateMcpServer,
  mockDeleteMcpServer,
  mockUpdateMcpServer,
  mockVerifyServerConnection,
} = vi.hoisted(() => ({
  mockCreateMcpServer: vi.fn(),
  mockDeleteMcpServer: vi.fn(),
  mockUpdateMcpServer: vi.fn(),
  mockVerifyServerConnection: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: {} }))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateMcpServer: mockCreateMcpServer,
  performDeleteMcpServer: mockDeleteMcpServer,
  performUpdateMcpServer: mockUpdateMcpServer,
}))

vi.mock('@/lib/mcp/service', () => ({
  mcpService: { verifyServerConnection: mockVerifyServerConnection },
}))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeManageMcpTool } from './manage-mcp-tool'

const context = {
  workspaceId: 'workspace-1',
  userId: 'user-1',
  userPermission: 'write',
} as ExecutionContext

describe('executeManageMcpTool verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifies a newly added server before returning it to the agent', async () => {
    mockCreateMcpServer.mockResolvedValue({
      success: true,
      serverId: 'mcp-1',
      updated: false,
      authType: 'headers',
    })
    mockVerifyServerConnection.mockResolvedValue({
      verified: true,
      toolCount: 3,
      requiresAuthorization: false,
    })

    const result = await executeManageMcpTool(
      {
        operation: 'add',
        config: { name: 'Memory', url: 'https://memory.example.com/mcp' },
      },
      context
    )

    expect(mockVerifyServerConnection).toHaveBeenCalledWith('user-1', 'mcp-1', 'workspace-1')
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        output: expect.objectContaining({
          serverId: 'mcp-1',
          verification: {
            verified: true,
            toolCount: 3,
            requiresAuthorization: false,
          },
        }),
      })
    )
  })

  it('retains a created server and reports a failed verification', async () => {
    mockCreateMcpServer.mockResolvedValue({
      success: true,
      serverId: 'mcp-1',
      updated: false,
      authType: 'headers',
    })
    mockVerifyServerConnection.mockResolvedValue({
      verified: false,
      toolCount: 0,
      requiresAuthorization: false,
      error: 'Connection failed',
    })

    const result = await executeManageMcpTool(
      {
        operation: 'add',
        config: { name: 'Memory', url: 'https://memory.example.com/mcp' },
      },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({
          verified: false,
          error: 'Connection failed',
        }),
      })
    )
  })

  it('skips verification when a newly added server is disabled', async () => {
    mockCreateMcpServer.mockResolvedValue({
      success: true,
      serverId: 'mcp-1',
      updated: false,
      authType: 'headers',
    })

    const result = await executeManageMcpTool(
      {
        operation: 'add',
        config: {
          name: 'Memory',
          url: 'https://memory.example.com/mcp',
          enabled: false,
        },
      },
      context
    )

    expect(mockVerifyServerConnection).not.toHaveBeenCalled()
    expect(result.output).toEqual(
      expect.objectContaining({
        verification: {
          verified: false,
          toolCount: 0,
          requiresAuthorization: false,
          skipped: true,
          reason: 'server_disabled',
        },
      })
    )
  })

  it('re-verifies a server after editing its connection config', async () => {
    mockUpdateMcpServer.mockResolvedValue({
      success: true,
      server: { id: 'mcp-1', name: 'Memory', enabled: true },
    })
    mockVerifyServerConnection.mockResolvedValue({
      verified: true,
      toolCount: 2,
      requiresAuthorization: false,
    })

    const result = await executeManageMcpTool(
      {
        operation: 'edit',
        serverId: 'mcp-1',
        config: { headers: { 'X-API-Key': '{{MEMORY_KEY}}' } },
      },
      context
    )

    expect(mockVerifyServerConnection).toHaveBeenCalledWith('user-1', 'mcp-1', 'workspace-1')
    expect(result.output).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({ verified: true, toolCount: 2 }),
      })
    )
  })

  it('skips verification after a cosmetic-only edit', async () => {
    mockUpdateMcpServer.mockResolvedValue({
      success: true,
      server: { id: 'mcp-1', name: 'Renamed Memory', enabled: true },
    })

    const result = await executeManageMcpTool(
      {
        operation: 'edit',
        serverId: 'mcp-1',
        config: { name: 'Renamed Memory' },
      },
      context
    )

    expect(mockVerifyServerConnection).not.toHaveBeenCalled()
    expect(result.output).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({
          verified: false,
          skipped: true,
          reason: 'connection_unchanged',
        }),
      })
    )
  })
})
