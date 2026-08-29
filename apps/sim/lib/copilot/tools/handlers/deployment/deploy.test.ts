/**
 * @vitest-environment node
 */
import { resetDbChainMock } from '@sim/testing'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckChatAccess,
  mockEnsureWorkflowAccess,
  mockPerformChatUndeploy,
  mockPerformDeleteWorkflowMcpTool,
  mockPerformFullDeploy,
  mockPerformFullUndeploy,
  mockExecuteCopilotMcpServerUseCase,
  mockExecuteCopilotWorkflowUseCase,
} = vi.hoisted(() => ({
  mockCheckChatAccess: vi.fn(),
  mockEnsureWorkflowAccess: vi.fn(),
  mockPerformChatUndeploy: vi.fn(),
  mockPerformDeleteWorkflowMcpTool: vi.fn(),
  mockPerformFullDeploy: vi.fn(),
  mockPerformFullUndeploy: vi.fn(),
  mockExecuteCopilotMcpServerUseCase: vi.fn(),
  mockExecuteCopilotWorkflowUseCase: vi.fn(),
}))

vi.mock('@/lib/copilot/application/execute-mcp-server-use-case', () => ({
  executeCopilotMcpServerUseCase: mockExecuteCopilotMcpServerUseCase,
}))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: mockExecuteCopilotWorkflowUseCase,
  messageForCopilotWorkflowError: (error: unknown, fallback: string) =>
    getErrorMessage(error, fallback),
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performChatDeploy: vi.fn(),
  performChatUndeploy: mockPerformChatUndeploy,
  performFullDeploy: mockPerformFullDeploy,
  performFullUndeploy: mockPerformFullUndeploy,
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpTool: vi.fn(),
  performDeleteWorkflowMcpTool: mockPerformDeleteWorkflowMcpTool,
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
  checkChatAccess: mockCheckChatAccess,
  checkWorkflowAccessForChatCreation: vi.fn(),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
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

describe('deployment handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockEnsureWorkflowAccess.mockResolvedValue({
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })
  })

  it('undeploys the API without approval context when permission gating is disabled', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({ success: true })

    const result = await executeDeployApi(
      { workflowId: 'workflow-1', action: 'undeploy' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        toolCallId: 'call-1',
      }
    )

    expect(result.success).toBe(true)
    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ operation: expect.objectContaining({ id: 'workflows.undeploy' }) }),
      expect.objectContaining({ workflowId: 'workflow-1' })
    )
  })

  it('uses the execution and deployment intent for semantic retry idempotency', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
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

    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ operation: expect.objectContaining({ id: 'workflows.deploy' }) }),
      expect.objectContaining({
        idempotencyKey: 'copilot:execution-1:operation:deploy_as_api',
      })
    )
  })

  it('does not report an admitted deployment as successful before its version is active', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      success: true,
      version: 12,
      deploymentVersionId: 'version-12',
      activeDeployment: { deploymentVersionId: 'version-11', version: 11 },
      latestDeploymentAttempt: { status: 'preparing', isCurrent: true },
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
      error: expect.stringContaining('not active'),
    })
    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ operation: expect.objectContaining({ id: 'workflows.deploy' }) }),
      expect.objectContaining({
        idempotencyKey: 'copilot:execution-1:operation:deploy_as_api',
      })
    )
  })

  it('reports success only when the version admitted by this call is active', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      success: true,
      version: 12,
      deploymentVersionId: 'version-12',
      activeDeployment: { deploymentVersionId: 'version-12', version: 12 },
      latestDeploymentAttempt: { status: 'active', isCurrent: true },
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
      success: true,
      output: {
        workflowId: 'workflow-1',
        isDeployed: true,
        version: 12,
        lifecycleStatus: 'active',
      },
    })
  })

  it('rejects a replay whose active deployment attempt became historical', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
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
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
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

  it('undeploys chat without approval context when permission gating is disabled', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      deployment: {
        id: 'chat-1',
        identifier: 'production-helper',
        title: 'Production Helper',
        description: null,
        authType: 'public',
        allowedEmails: [],
        outputConfigs: [],
        includeThinking: false,
        includeToolCalls: false,
        customizations: null,
      },
    })

    const result = await executeDeployChat(
      { workflowId: 'workflow-1', action: 'undeploy' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        toolCallId: 'call-1',
      }
    )

    expect(result.success).toBe(true)
    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.chat.undeploy' }),
      }),
      expect.objectContaining({ workflowId: 'workflow-1' })
    )
  })

  it('undeploys MCP without approval context when permission gating is disabled', async () => {
    mockExecuteCopilotMcpServerUseCase.mockResolvedValue({
      server: { id: 'server-1', name: 'Production MCP' },
      tool: { id: 'tool-1', toolName: 'run_workflow' },
      workflow: { id: 'workflow-1' },
    })

    const result = await executeDeployMcp(
      { workflowId: 'workflow-1', serverId: 'server-1', action: 'undeploy' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        toolCallId: 'call-1',
      }
    )

    expect(result.success).toBe(true)
    expect(mockExecuteCopilotMcpServerUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        operation: expect.objectContaining({
          id: 'mcp_servers.workflow_deployments.undeploy_tool',
        }),
      }),
      { serverId: 'server-1', workflowId: 'workflow-1' }
    )
  })
})
