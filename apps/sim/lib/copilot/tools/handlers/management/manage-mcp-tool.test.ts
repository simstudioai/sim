/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeCopilotMcpServerUseCase: vi.fn(),
  listMcpServersUseCase: { operation: { id: 'mcp_servers.list' } },
}))

vi.mock('@/lib/copilot/application/execute-mcp-server-use-case', () => ({
  executeCopilotMcpServerUseCase: mocks.executeCopilotMcpServerUseCase,
}))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  deleteMcpServerUseCase: { operation: { id: 'mcp_servers.delete' } },
  listMcpServersUseCase: mocks.listMcpServersUseCase,
  reconfigureMcpServerUseCase: { operation: { id: 'mcp_servers.reconfigure' } },
  registerMcpServerUseCase: { operation: { id: 'mcp_servers.register' } },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

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
    mocks.executeCopilotMcpServerUseCase.mockResolvedValue({ servers: [SERVER] })
  })

  it('omits raw URLs from secretless workspace chat', async () => {
    const context = { ...CONTEXT, secretActorUserId: null }
    const result = await executeManageMcpTool({ operation: 'list' }, context)

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
    expect(mocks.executeCopilotMcpServerUseCase).toHaveBeenCalledWith(
      context,
      mocks.listMcpServersUseCase,
      { workspaceId: 'workspace-1' }
    )
  })

  it('keeps URLs for normal user-backed chat', async () => {
    const result = await executeManageMcpTool({ operation: 'list' }, CONTEXT)

    expect(result.output).toMatchObject({ servers: [{ url: SERVER.url }] })
    expect(mocks.executeCopilotMcpServerUseCase).toHaveBeenCalledOnce()
  })
})
