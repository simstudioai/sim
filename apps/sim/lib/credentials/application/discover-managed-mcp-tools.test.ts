/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkflow: vi.fn(),
  discoverTools: vi.fn(),
  loadAuthProvider: vi.fn(),
  loadContext: vi.fn(),
  loadRuntime: vi.fn(),
  requireCredentialAccess: vi.fn(),
  resolvePermission: vi.fn(),
  saveToolSnapshot: vi.fn(),
}))

vi.mock('@sim/workflow-persistence', () => ({
  loadWorkflowFromNormalizedTablesRaw: mocks.loadWorkflow,
}))

vi.mock('@/lib/credentials/managed-mcp', () => ({
  loadManagedMcpCredentialApplicationContext: mocks.loadContext,
  loadManagedMcpRuntimeCredential: mocks.loadRuntime,
  saveManagedMcpToolSnapshot: mocks.saveToolSnapshot,
}))

vi.mock('@/lib/credential-groups/application/authorization', () => ({
  requireCredentialGroupCredentialAccess: mocks.requireCredentialAccess,
}))

vi.mock('@/lib/mcp/application/managed-auth-provider', () => ({
  loadManagedMcpAuthProvider: mocks.loadAuthProvider,
}))

vi.mock('@/lib/mcp/oauth', () => ({
  withMcpOauthRefreshLock: vi.fn((_credentialId: string, operation: () => Promise<unknown>) =>
    operation()
  ),
}))

vi.mock('@/lib/mcp/service', () => ({
  mcpService: { discoverManagedMcpTools: mocks.discoverTools },
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { discoverManagedMcpToolsUseCase } from '@/lib/credentials/application/discover-managed-mcp-tools'

const context = {
  credentialId: 'mcp-cg-123456789012345678901',
  credentialGroupId: 'group-1',
  credentialGroupEnrollmentId: 'selected-enrollment',
  mcpServerId: 'mcp-fireflies',
  mcpServerName: 'Fireflies',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
}

const principal: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'execution-user',
  workspaceId: context.workspaceId,
  delegationId: 'delegation-1',
  audience: 'sim:managed-mcp-credentials',
  issuedAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { credentialId: context.credentialId, mcpBlockId: 'block-1' },
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    principal: { kind: 'session', userId: 'execution-user', sessionId: 'session-1' },
    currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
  },
}

describe('discoverManagedMcpToolsUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mocks.loadAuthProvider.mockResolvedValue({})
    mocks.requireCredentialAccess.mockResolvedValue(undefined)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.discoverTools.mockResolvedValue([
      {
        name: 'search_transcripts',
        description: 'Search transcripts',
        inputSchema: { type: 'object', properties: {} },
        serverId: context.mcpServerId,
        serverName: context.mcpServerName,
      },
    ])
  })

  it('discovers through the explicit credential and projects that ID as the tool server', async () => {
    const signal = new AbortController().signal
    const result = await discoverManagedMcpToolsUseCase.execute({
      principal,
      input: {
        workspaceId: context.workspaceId,
        credentialId: context.credentialId,
        signal,
      },
    })

    expect(mocks.requireCredentialAccess).toHaveBeenCalledWith(principal, context, {
      resourceType: 'credential_group',
      action: 'credential_groups.credentials.use',
    })
    expect(mocks.loadRuntime).toHaveBeenCalledWith(context.credentialId, context.workspaceId)
    expect(mocks.discoverTools).toHaveBeenCalledWith(
      context.mcpServerId,
      { kind: 'organization', organizationId: 'org-1' },
      { credentialId: context.credentialId, loadProvider: expect.any(Function) },
      signal,
      { requireComplete: true }
    )
    expect(result.tools).toEqual([
      expect.objectContaining({
        name: 'search_transcripts',
        serverId: context.credentialId,
        canonicalServerId: context.mcpServerId,
        serverName: context.mcpServerName,
      }),
    ])
    expect(mocks.saveToolSnapshot).toHaveBeenCalledWith(
      context.credentialId,
      [
        {
          name: 'search_transcripts',
          description: 'Search transcripts',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      2,
      new Date('2026-09-01')
    )
  })
})
