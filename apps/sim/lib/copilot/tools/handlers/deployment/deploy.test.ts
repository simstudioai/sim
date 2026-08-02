/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureWorkflowAccess, mockPerformFullDeploy, mockPerformFullUndeploy } = vi.hoisted(
  () => ({
    mockEnsureWorkflowAccess: vi.fn(),
    mockPerformFullDeploy: vi.fn(),
    mockPerformFullUndeploy: vi.fn(),
  })
)

vi.mock('@/lib/workflows/orchestration', () => ({
  performChatDeploy: vi.fn(),
  performChatUndeploy: vi.fn(),
  performFullDeploy: mockPerformFullDeploy,
  performFullUndeploy: mockPerformFullUndeploy,
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpTool: vi.fn(),
  performDeleteWorkflowMcpTool: vi.fn(),
  performUpdateWorkflowMcpTool: vi.fn(),
}))

vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  getDeployedWorkflowInputFormat: vi.fn(),
}))

vi.mock('@/lib/mcp/workflow-tool-schema', () => ({
  applyDescriptionOverrides: vi.fn(),
  generateToolInputSchema: vi.fn(),
  sanitizeToolName: vi.fn(),
}))

vi.mock('@/app/api/chat/utils', () => ({
  checkChatAccess: vi.fn(),
  checkWorkflowAccessForChatCreation: vi.fn(),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  ChatDeployAuthNotAllowedError: class ChatDeployAuthNotAllowedError extends Error {},
  validateChatDeployAuth: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkflowAccess: mockEnsureWorkflowAccess,
}))

import {
  executeDeployApi,
  executeDeployChat,
  executeDeployMcp,
  executeRedeploy,
} from '@/lib/copilot/tools/handlers/deployment/deploy'

describe('executeDeployApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureWorkflowAccess.mockResolvedValue({
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })
  })

  it('refuses undeploy without approval for the exact tool call', async () => {
    const result = await executeDeployApi(
      { workflowId: 'workflow-1', action: 'undeploy' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        toolCallId: 'call-1',
        userApprovedToolCall: false,
      }
    )

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('approval') })
    expect(mockPerformFullUndeploy).not.toHaveBeenCalled()
  })

  it('allows an explicitly approved undeploy', async () => {
    mockPerformFullUndeploy.mockResolvedValue({ success: true })

    const result = await executeDeployApi(
      { workflowId: 'workflow-1', action: 'undeploy' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        toolCallId: 'call-1',
        userApprovedToolCall: true,
      }
    )

    expect(result.success).toBe(true)
    expect(mockPerformFullUndeploy).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'user-1',
    })
  })

  it('uses the tool-call identity for deployment idempotency', async () => {
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      activeDeployment: null,
      latestDeploymentAttempt: { status: 'preparing' },
    })

    await executeDeployApi(
      {
        workflowId: 'workflow-1',
        action: 'deploy',
        versionName: 'Safe deploy',
        versionDescription: 'Deploy the latest workflow changes',
      },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        toolCallId: 'call-1',
      }
    )

    expect(mockPerformFullDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'copilot:execution-1:tool-call:call-1',
      })
    )
  })

  it('rejects a replay whose active deployment attempt became historical', async () => {
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      activeDeployment: null,
      latestDeploymentAttempt: { status: 'active', isCurrent: false },
    })

    const result = await executeDeployApi(
      {
        workflowId: 'workflow-1',
        action: 'deploy',
        versionName: 'Safe deploy',
        versionDescription: 'Deploy the latest workflow changes',
      },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        toolCallId: 'call-1',
      }
    )

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('historical'),
    })
  })

  it('does not report a historical active attempt as a successful redeploy', async () => {
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      activeDeployment: null,
      latestDeploymentAttempt: { status: 'active', isCurrent: false },
    })

    const result = await executeRedeploy(
      {
        workflowId: 'workflow-1',
        versionName: 'Safe redeploy',
        versionDescription: 'Redeploy the latest workflow changes',
      },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        toolCallId: 'call-1',
      }
    )

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('historical'),
    })
  })

  it('refuses chat undeploy without exact-call approval', async () => {
    const result = await executeDeployChat(
      { workflowId: 'workflow-1', action: 'undeploy' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        toolCallId: 'call-1',
        userApprovedToolCall: false,
      }
    )

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('approval') })
  })

  it('refuses MCP undeploy without exact-call approval', async () => {
    const result = await executeDeployMcp(
      { workflowId: 'workflow-1', serverId: 'server-1', action: 'undeploy' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        toolCallId: 'call-1',
        userApprovedToolCall: false,
      }
    )

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('approval') })
  })
})
