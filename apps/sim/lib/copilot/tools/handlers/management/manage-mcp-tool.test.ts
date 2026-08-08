/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { select, from, where } = vi.hoisted(() => {
  const where = vi.fn()
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return { select, from, where }
})

vi.mock('@sim/db', () => ({ db: { select } }))
vi.mock('@sim/db/schema', () => ({
  mcpServers: {
    workspaceId: 'workspaceId',
    deletedAt: 'deletedAt',
  },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((left: unknown, right: unknown) => [left, right]),
  isNull: vi.fn((value: unknown) => [value, null]),
}))
vi.mock('@/lib/copilot/tools/permissions', () => ({
  copilotToolCanWrite: vi.fn(() => true),
  copilotWriteDeniedMessage: vi.fn(),
}))
vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateMcpServer: vi.fn(),
  performDeleteMcpServer: vi.fn(),
  performUpdateMcpServer: vi.fn(),
}))

import { executeManageMcpTool } from './manage-mcp-tool'

const SERVER = {
  id: 'server-1',
  name: 'Private MCP',
  url: 'https://user:secret@example.com/mcp?token=sentinel',
  transport: 'streamable-http',
  enabled: true,
  connectionStatus: 'connected',
}

const CONTEXT = {
  userId: 'user-1',
  workflowId: '',
  workspaceId: 'workspace-1',
  userPermission: 'admin',
}

describe('manage_mcp_tool list projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    where.mockResolvedValue([SERVER])
  })

  it('omits raw URLs from secretless workspace chat', async () => {
    const result = await executeManageMcpTool(
      { operation: 'list' },
      { ...CONTEXT, secretActorUserId: null }
    )

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      servers: [
        {
          id: 'server-1',
          name: 'Private MCP',
          transport: 'streamable-http',
          enabled: true,
          connectionStatus: 'connected',
        },
      ],
    })
    expect(JSON.stringify(result.output)).not.toContain('sentinel')
  })

  it('keeps URLs for normal user-backed chat', async () => {
    const result = await executeManageMcpTool({ operation: 'list' }, CONTEXT)

    expect(result.output).toMatchObject({ servers: [{ url: SERVER.url }] })
    expect(select).toHaveBeenCalledOnce()
    expect(from).toHaveBeenCalledOnce()
  })
})
