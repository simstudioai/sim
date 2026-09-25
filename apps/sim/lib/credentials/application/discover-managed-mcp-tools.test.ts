/**
 * @vitest-environment node
 */
import { serializePrincipal, type WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
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
  executionContext: vi.fn(),
  workspaceContext: vi.fn(),
  config: vi.fn(),
  build: vi.fn(),
}))

vi.mock('@/lib/mothership/chat/payload', () => ({
  buildIntegrationToolSchemas: mocks.build,
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  listMcpServersUseCase: { execute: vi.fn() },
  discoverMcpServerToolsUseCase: { execute: vi.fn() },
  getMcpServerUseCase: { execute: vi.fn() },
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspaceContext,
}))
vi.mock('@/lib/permission-groups/config-scope.server', () => ({
  resolvePermissionGroupConfig: mocks.config,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowExecutionApplicationContext: mocks.executionContext,
  resolveActiveWorkflowRunApplicationContext: mocks.executionContext,
  resolveActiveWorkflowApplicationContext: mocks.executionContext,
  resolveActiveWorkflowDeploymentVersionApplicationContext: mocks.executionContext,
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
import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { IntegrationCatalogRequest } from '@/lib/mothership/generated/integration-catalog'
import {
  INTEGRATION_CATALOG_AUDIENCE,
  readIntegrationCatalog,
} from '@/lib/mothership/integrations/application/catalog'

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
    mocks.build.mockResolvedValue([])
    mocks.config.mockResolvedValue(null)
    mocks.workspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    })
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
    mocks.executionContext.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      deploymentVersionId: null,
    })
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
  it.each(['draft', 'deployment'] as const)(
    'catalog preserves managed executor authority and %s operation policy',
    async (mode) => {
      const currentWorkflow =
        mode === 'draft'
          ? { workflowId: 'workflow-1', mode }
          : { workflowId: 'workflow-1', mode, deploymentVersionId: 'version-1' }
      mocks.executionContext.mockResolvedValue({
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        deploymentVersionId: mode === 'draft' ? null : 'version-1',
      })
      const input = IntegrationCatalogRequest.parse({
        mode: 'agent',
        toolId: `${context.credentialId}-search_transcripts`,
        mcpToolIds: [`${context.credentialId}-search_transcripts`],
        mcpExecution: {
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          mcpBlockId: 'block-1',
          subjectUserId: 'execution-user',
          principal: serializePrincipal({
            kind: 'session',
            userId: 'execution-user',
            sessionId: 'session-1',
          }),
          currentWorkflow,
        },
      })
      const caller = createTrustedCopilotPrincipal(
        { userId: 'execution-user', workspaceId: context.workspaceId, delegationId: 'catalog' },
        { audience: INTEGRATION_CATALOG_AUDIENCE, ttlMs: 60_000 }
      )
      const result = await readIntegrationCatalog.execute({ principal: caller, input })
      expect(result.operations[0]?.toolId).toBe(`${context.credentialId}-search_transcripts`)
      expect(mocks.requireCredentialAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: 'executor',
          resourceScope: { credentialId: context.credentialId, mcpBlockId: 'block-1' },
          delegationContext: expect.objectContaining({ currentWorkflow }),
        }),
        context,
        expect.anything()
      )
      mocks.loadWorkflow.mockResolvedValue({ workspaceId: 'workspace-1', blocks: {} })
      if (mode === 'draft')
        await expect(readIntegrationCatalog.execute({ principal: caller, input })).rejects.toThrow(
          'source block is missing'
        )
      else
        expect(
          (await readIntegrationCatalog.execute({ principal: caller, input })).operations
        ).toHaveLength(1)
    }
  )
  it('catalog rejects substituted executor subject before credential discovery', async () => {
    const caller = createTrustedCopilotPrincipal(
      { userId: 'execution-user', workspaceId: context.workspaceId, delegationId: 'catalog' },
      { audience: INTEGRATION_CATALOG_AUDIENCE, ttlMs: 60_000 }
    )
    const input = IntegrationCatalogRequest.parse({
      mode: 'agent',
      toolId: `${context.credentialId}-search_transcripts`,
      mcpToolIds: [`${context.credentialId}-search_transcripts`],
      mcpExecution: {
        workflowId: 'workflow-1',
        mcpBlockId: 'block-1',
        subjectUserId: 'another-user',
      },
    })
    await expect(readIntegrationCatalog.execute({ principal: caller, input })).rejects.toThrow(
      'subject does not match'
    )
    expect(mocks.discoverTools).not.toHaveBeenCalled()
  })
  it('keeps Copilot capability gating for chats but exempts canonically rebound workflow discovery', async () => {
    mocks.workspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'org-1',
      allowPersonalApiKeys: true,
    })
    mocks.config.mockResolvedValue({ hideCopilot: true })
    const caller = createTrustedCopilotPrincipal(
      { userId: 'execution-user', workspaceId: context.workspaceId, delegationId: 'catalog' },
      { audience: INTEGRATION_CATALOG_AUDIENCE, ttlMs: 60_000 }
    )
    const chatInput = IntegrationCatalogRequest.parse({ mode: 'agent', query: 'gmail' })
    await expect(
      readIntegrationCatalog.execute({ principal: caller, input: chatInput })
    ).rejects.toThrow()
    expect(mocks.build).not.toHaveBeenCalled()
    const input = IntegrationCatalogRequest.parse({
      ...chatInput,
      mcpExecution: {
        workflowId: 'workflow-1',
        mcpBlockId: 'block-1',
        subjectUserId: 'execution-user',
      },
    })
    await expect(readIntegrationCatalog.execute({ principal: caller, input })).resolves.toEqual({
      total: 0,
      truncated: false,
      operations: [],
    })
    expect(mocks.build).toHaveBeenCalledOnce()
    mocks.executionContext.mockRejectedValueOnce(new Error('Invalid canonical execution'))
    await expect(
      readIntegrationCatalog.execute({
        principal: caller,
        input: { ...input, mcpExecution: { ...input.mcpExecution!, workflowId: 'forged' } },
      })
    ).rejects.toThrow('Invalid canonical execution')
    expect(mocks.build).toHaveBeenCalledOnce()
  })
})
