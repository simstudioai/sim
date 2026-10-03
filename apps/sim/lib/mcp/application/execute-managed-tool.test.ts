import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import {
  createExecutorPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { mcpOauthMock } from '@sim/testing/mocks/mcp-oauth.mock'
import { mcpServiceMock, mcpServiceMockFns } from '@sim/testing/mocks/mcp-service.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  loadWorkflow: vi.fn(),
  loadAuthProvider: vi.fn(),
  loadContext: vi.fn(),
  loadRuntime: vi.fn(),
  requireCredentialAccess: vi.fn(),
  saveToolSnapshot: vi.fn(),
}))

vi.mock('@sim/workflow-persistence', () => ({
  loadWorkflowFromNormalizedTablesRaw: hoisted.loadWorkflow,
}))

vi.mock('@/lib/credentials/managed-mcp', () => ({
  loadManagedMcpCredentialApplicationContext: hoisted.loadContext,
  loadManagedMcpRuntimeCredential: hoisted.loadRuntime,
  saveManagedMcpToolSnapshot: hoisted.saveToolSnapshot,
}))

vi.mock('@/lib/credential-groups/application/authorization', () => ({
  requireCredentialGroupCredentialAccess: hoisted.requireCredentialAccess,
}))

vi.mock('@/lib/mcp/service', () => mcpServiceMock)

vi.mock('@/lib/mcp/oauth', () => mcpOauthMock)

vi.mock('@/lib/mcp/application/managed-auth-provider', () => ({
  loadManagedMcpAuthProvider: hoisted.loadAuthProvider,
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { executeManagedMcpToolUseCase } from '@/lib/mcp/application/execute-managed-tool'
import { createCopilotApplicationPrincipal } from '@/lib/mothership/auth/application-delegation'

const mocks = {
  ...hoisted,
  discoverTools: mcpServiceMockFns.mockDiscoverManagedMcpTools,
  executeTool: mcpServiceMockFns.mockExecuteManagedMcpTool,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const context = {
  credentialId: 'mcp-cg-123456789012345678901',
  credentialGroupId: 'group-1',
  credentialGroupEnrollmentId: 'enrollment-1',
  mcpServerId: 'mcp-server-1',
  mcpServerName: 'Fireflies',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
}

const principal: WorkflowExecutionDelegatedPrincipal = createExecutorPrincipal({
  audience: 'sim:managed-mcp-credentials',
  issuedAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { credentialId: context.credentialId, mcpBlockId: 'block-1' },
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    principal: createSessionPrincipal(),
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment',
      deploymentVersionId: 'version-1',
    },
  },
})

const copilotPrincipal = createCopilotApplicationPrincipal(
  {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    chatId: 'chat-1',
    toolCallId: 'call-1',
    copilotToolExecution: true,
  },
  {
    audience: 'sim:managed-mcp-credentials',
    ttlMs: 60_000,
    resourceScope: { credentialId: context.credentialId },
    createDelegationId: () => 'copilot:call-1',
  }
)

describe('executeManagedMcpToolUseCase', () => {
  beforeEach(() => {
    resetDbChainMock()
    const savedWorkflow = {
      workspaceId: 'workspace-1',
      blocks: {
        'block-1': {
          type: 'mcp',
          enabled: true,
          subBlocks: {
            server: { value: context.credentialId },
            tool: { value: 'search_transcripts' },
          },
        },
      },
    }
    mocks.loadWorkflow.mockResolvedValue(savedWorkflow)
    queueTableRows(schemaMock.workflowDeploymentVersion, [{ state: savedWorkflow }])
    queueTableRows(schemaMock.workflowDeploymentVersion, [{ state: savedWorkflow }])
    mocks.loadContext.mockResolvedValue(context)
    mocks.loadRuntime.mockResolvedValue({
      credentialId: context.credentialId,
      mcpServerId: context.mcpServerId,
      mcpServerName: context.mcpServerName,
      workspaceId: context.workspaceId,
      scope: { kind: 'organization', organizationId: 'org-1' },
      oauthConfigVersion: 2,
      grantedAt: new Date('2026-09-01'),
      tokenVersion: 'encrypted-token-version-1',
      tokens: { access_token: 'access-token' },
      tools: [],
    })
    mocks.requireCredentialAccess.mockResolvedValue(undefined)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.loadAuthProvider.mockResolvedValue({})
    mocks.discoverTools.mockResolvedValue([])
    mocks.executeTool.mockResolvedValue({ content: [{ type: 'text', text: 'done' }] })
  })

  it.each([principal, copilotPrincipal])(
    'does not load token material when Credential Group policy denies $serviceId execution',
    async (principal) => {
      mocks.requireCredentialAccess.mockRejectedValueOnce({
        code: 'forbidden',
        message: 'Credential Group credential access denied',
      })

      await expect(
        executeManagedMcpToolUseCase.execute({
          principal,
          input: {
            workspaceId: 'workspace-1',
            credentialId: context.credentialId,
            toolName: 'search_transcripts',
            arguments: {},
          },
        })
      ).rejects.toMatchObject({
        code: 'forbidden',
        message: 'Credential Group credential access denied',
      })

      expect(mocks.requireCredentialAccess).toHaveBeenCalledWith(principal, context, {
        resourceType: 'credential_group',
        action: 'credential_groups.credentials.use',
      })
      expect(mocks.loadRuntime).not.toHaveBeenCalled()
      expect(mocks.executeTool).not.toHaveBeenCalled()
    }
  )

  it('fails fast when the live tool schema is invalid', async () => {
    mocks.discoverTools.mockResolvedValueOnce([{ name: 'search_transcripts', inputSchema: null }])

    await expect(
      executeManagedMcpToolUseCase.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          credentialId: context.credentialId,
          toolName: 'search_transcripts',
          arguments: {},
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Managed MCP tool schema is invalid',
    })

    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('rejects a connection resolved for another canonical server', async () => {
    await expect(
      executeManagedMcpToolUseCase.execute({
        principal,
        input: {
          workspaceId: context.workspaceId,
          credentialId: context.credentialId,
          assertedServerId: 'other-server',
          toolName: 'search_transcripts',
        },
      })
    ).rejects.toThrow('does not belong')
    expect(mocks.discoverTools).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('enforces the saved block allowlist before discovering managed operations', async () => {
    mocks.loadWorkflow.mockResolvedValue({
      workspaceId: context.workspaceId,
      blocks: {
        'block-1': {
          type: 'agent',
          subBlocks: {
            tools: {
              value: [
                {
                  type: 'mcp-server-advanced',
                  params: { serverId: context.credentialId },
                  operationPolicy: { mode: 'allow', operations: [] },
                },
              ],
            },
          },
        },
      },
    })
    await expect(
      executeManagedMcpToolUseCase.execute({
        principal: {
          ...principal,
          delegationContext: {
            ...principal.delegationContext,
            currentWorkflow: { mode: 'draft', workflowId: 'workflow-1' },
          },
        },
        input: {
          workspaceId: context.workspaceId,
          credentialId: context.credentialId,
          toolName: 'search_transcripts',
        },
      })
    ).rejects.toThrow('not permitted')
    expect(mocks.discoverTools).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('rejects credentials changed during discovery and never substitutes a connection', async () => {
    const runtime = await mocks.loadRuntime()
    mocks.loadRuntime
      .mockResolvedValueOnce(runtime)
      .mockResolvedValue({ ...runtime, oauthConfigVersion: runtime.oauthConfigVersion + 1 })
    mocks.discoverTools.mockResolvedValue([
      { name: 'search_transcripts', inputSchema: { type: 'object', properties: {} } },
    ])
    await expect(
      executeManagedMcpToolUseCase.execute({
        principal,
        input: {
          workspaceId: context.workspaceId,
          credentialId: context.credentialId,
          toolName: 'search_transcripts',
        },
      })
    ).rejects.toThrow('credential changed during discovery')
    expect(mocks.executeTool).not.toHaveBeenCalled()
    expect(mocks.loadRuntime.mock.calls.slice(1)).toEqual([
      [context.credentialId, context.workspaceId],
      [context.credentialId, context.workspaceId],
    ])
  })

  it('fails closed for incomplete discovery and a missing operation', async () => {
    const input = {
      workspaceId: context.workspaceId,
      credentialId: context.credentialId,
      toolName: 'search_transcripts',
    }
    mocks.discoverTools.mockRejectedValueOnce(new Error('discovery timed out'))
    await expect(executeManagedMcpToolUseCase.execute({ principal, input })).rejects.toThrow(
      'discovery timed out'
    )
    await expect(executeManagedMcpToolUseCase.execute({ principal, input })).rejects.toThrow(
      'Tool not found'
    )
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('rechecks workspace and credential access after discovery', async () => {
    mocks.requireCredentialAccess
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Workspace access revoked'))
    mocks.discoverTools.mockResolvedValue([
      { name: 'search_transcripts', inputSchema: { type: 'object', properties: {} } },
    ])
    await expect(
      executeManagedMcpToolUseCase.execute({
        principal,
        input: {
          workspaceId: context.workspaceId,
          credentialId: context.credentialId,
          toolName: 'search_transcripts',
        },
      })
    ).rejects.toThrow('Workspace access revoked')
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })
})
