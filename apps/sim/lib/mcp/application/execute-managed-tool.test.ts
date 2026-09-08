/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  discoverTools: vi.fn(),
  executeTool: vi.fn(),
  loadAuthProvider: vi.fn(),
  loadContext: vi.fn(),
  loadRuntime: vi.fn(),
  requireCredentialAccess: vi.fn(),
  resolvePermission: vi.fn(),
  saveToolSnapshot: vi.fn(),
}))

vi.mock('@/lib/credentials/managed-mcp', () => ({
  loadManagedMcpCredentialApplicationContext: mocks.loadContext,
  loadManagedMcpRuntimeCredential: mocks.loadRuntime,
  saveManagedMcpToolSnapshot: mocks.saveToolSnapshot,
}))

vi.mock('@/lib/credential-groups/application/authorization', () => ({
  requireCredentialGroupCredentialAccess: mocks.requireCredentialAccess,
}))

vi.mock('@/lib/mcp/service', () => ({
  mcpService: {
    discoverManagedMcpTools: mocks.discoverTools,
    executeManagedMcpTool: mocks.executeTool,
  },
}))

vi.mock('@/lib/mcp/oauth', () => ({
  withMcpOauthRefreshLock: vi.fn((_credentialId: string, operation: () => Promise<unknown>) =>
    operation()
  ),
}))

vi.mock('@/lib/mcp/application/managed-auth-provider', () => ({
  loadManagedMcpAuthProvider: mocks.loadAuthProvider,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { executeManagedMcpToolUseCase } from '@/lib/mcp/application/execute-managed-tool'

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

const principal: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:managed-mcp-credentials',
  issuedAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { credentialId: context.credentialId },
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment',
      deploymentVersionId: 'version-1',
    },
  },
}

describe('executeManagedMcpToolUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('does not load token material when Credential Group policy denies execution', async () => {
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
  })

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

  it('discovers and executes with the explicitly selected managed connection', async () => {
    const signal = new AbortController().signal
    mocks.discoverTools.mockResolvedValueOnce([
      {
        name: 'search_transcripts',
        description: 'Search Fireflies transcripts',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: { query: { type: 'string' } },
        },
      },
    ])

    const result = await executeManagedMcpToolUseCase.execute({
      principal,
      input: {
        workspaceId: context.workspaceId,
        credentialId: context.credentialId,
        toolName: 'search_transcripts',
        arguments: { query: 'onboarding' },
        signal,
      },
    })

    expect(result).toEqual({
      success: true,
      output: { content: [{ type: 'text', text: 'done' }] },
    })
    expect(mocks.loadRuntime).toHaveBeenCalledWith(context.credentialId, context.workspaceId)
    expect(mocks.discoverTools).toHaveBeenCalledWith(
      context.mcpServerId,
      { kind: 'organization', organizationId: 'org-1' },
      { credentialId: context.credentialId, loadProvider: expect.any(Function) },
      signal,
      { requireComplete: true }
    )
    expect(mocks.saveToolSnapshot).toHaveBeenCalledWith(
      context.credentialId,
      [
        {
          name: 'search_transcripts',
          description: 'Search Fireflies transcripts',
          inputSchema: {
            type: 'object',
            required: ['query'],
            properties: { query: { type: 'string' } },
          },
        },
      ],
      2,
      new Date('2026-09-01')
    )
    expect(mocks.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: context.credentialId,
        serverId: context.mcpServerId,
        scope: { kind: 'organization', organizationId: 'org-1' },
        toolCall: {
          name: 'search_transcripts',
          arguments: { query: 'onboarding' },
        },
      })
    )
  })
})
