/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeTool: vi.fn(),
  loadContext: vi.fn(),
  loadRuntime: vi.fn(),
  requireCredentialAccess: vi.fn(),
  resolvePermission: vi.fn(),
  saveTokens: vi.fn(),
}))

vi.mock('@/lib/credentials/managed-mcp', () => ({
  loadManagedMcpCredentialApplicationContext: mocks.loadContext,
  loadManagedMcpRuntimeCredential: mocks.loadRuntime,
  saveManagedMcpRuntimeTokens: mocks.saveTokens,
}))

vi.mock('@/lib/credential-groups/application/authorization', () => ({
  requireCredentialGroupCredentialAccess: mocks.requireCredentialAccess,
}))

vi.mock('@/lib/mcp/service', () => ({
  mcpService: { executeManagedMcpTool: mocks.executeTool },
}))

vi.mock('@/lib/mcp/oauth', () => ({
  getOrCreateOauthRow: vi.fn(),
  loadPreregisteredClient: vi.fn(),
}))

vi.mock('@/lib/mcp/oauth/managed-provider', () => ({
  ManagedMcpOauthProvider: class ManagedMcpOauthProvider {},
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
    mocks.resolvePermission.mockResolvedValue('read')
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
})
