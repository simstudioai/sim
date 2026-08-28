/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  getServer: vi.fn(),
  resolvePermission: vi.fn(),
  assertPermissionsAllowed: vi.fn(),
  discoverServerTools: vi.fn(),
  executeTool: vi.fn(),
  telemetry: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  loadActiveWorkspaceContext: mocks.loadContext,
}))
vi.mock('@/lib/mcp/queries', () => ({ getWorkspaceMcpServer: mocks.getServer }))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: mocks.assertPermissionsAllowed,
  McpToolsNotAllowedError: class McpToolsNotAllowedError extends Error {},
}))
vi.mock('@/lib/mcp/service', () => ({
  mcpService: {
    discoverServerTools: mocks.discoverServerTools,
    executeTool: mocks.executeTool,
  },
}))
vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { mcpToolExecuted: mocks.telemetry },
}))

import { executeMcpToolUseCase } from '@/lib/mcp/application/execute-tool'

const WORKSPACE = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}
const SERVER = {
  id: 'mcp-server-1',
  workspaceId: WORKSPACE.workspaceId,
  enabled: true,
}
const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: WORKSPACE.workspaceId,
  delegationId: 'delegation-1',
  audience: 'sim:mcp-servers',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2099-08-27T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}
const ACTORLESS_PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: WORKSPACE.workspaceId,
  delegationId: 'delegation-system',
  audience: 'sim:mcp-servers',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2099-08-27T00:05:00.000Z'),
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment',
      deploymentVersionId: 'deployment-1',
    },
    principal: {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: WORKSPACE.workspaceId,
      workflowId: 'workflow-1',
    },
  },
}

describe('executeMcpToolUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(WORKSPACE)
    mocks.getServer.mockResolvedValue(SERVER)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.discoverServerTools.mockResolvedValue([
      {
        name: 'lookup',
        inputSchema: {
          type: 'object',
          required: ['count'],
          properties: {
            count: { type: 'integer' },
            enabled: { type: 'boolean' },
            tags: { type: 'array' },
          },
        },
      },
    ])
    mocks.executeTool.mockResolvedValue({ content: [{ type: 'text', text: 'done' }] })
  })

  it('authorizes, coerces the discovered schema, and preserves execution context', async () => {
    const provenance = vi.fn()
    const signal = new AbortController().signal
    const result = await executeMcpToolUseCase.execute({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE.workspaceId,
        serverId: SERVER.id,
        toolName: 'lookup',
        arguments: { count: '2', enabled: 'true', tags: 'a,b' },
        callChain: ['workflow-parent', 'workflow-1'],
        timeoutMs: 12_000,
        signal,
        onResolvedSecretTraceProvenance: provenance,
      },
    })

    expect(result).toEqual({
      success: true,
      output: { content: [{ type: 'text', text: 'done' }] },
    })
    expect(mocks.assertPermissionsAllowed).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: WORKSPACE.workspaceId,
      toolKind: 'mcp',
    })
    expect(mocks.executeTool).toHaveBeenCalledWith(
      'user-1',
      SERVER.id,
      {
        name: 'lookup',
        arguments: { count: 2, enabled: true, tags: ['a', 'b'] },
      },
      WORKSPACE.workspaceId,
      { 'X-Sim-Via': 'workflow-parent,workflow-1' },
      provenance,
      { signal, timeoutMs: 12_000 }
    )
    expect(mocks.telemetry).toHaveBeenCalledOnce()
  })

  it('rejects foreign or missing servers before permission and provider work', async () => {
    mocks.getServer.mockResolvedValueOnce(null)

    await expect(
      executeMcpToolUseCase.execute({
        principal: PRINCIPAL,
        input: {
          workspaceId: WORKSPACE.workspaceId,
          serverId: 'mcp-foreign',
          toolName: 'lookup',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'MCP server not found' })

    expect(mocks.assertPermissionsAllowed).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('does not invent a user for actorless system execution', async () => {
    // An MCP call presents one person's credentials, so with nobody named at all it
    // must refuse rather than reach for a stand-in. It refuses as `forbidden` so the
    // caller is told why, instead of the unclassified 500 this used to produce.
    await expect(
      executeMcpToolUseCase.execute({
        principal: ACTORLESS_PRINCIPAL,
        input: {
          workspaceId: WORKSPACE.workspaceId,
          serverId: SERVER.id,
          toolName: 'lookup',
        },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message:
        'MCP servers are reached with a user\u2019s own credentials, and this run has no user',
    })

    expect(mocks.assertPermissionsAllowed).not.toHaveBeenCalled()
    expect(mocks.discoverServerTools).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('runs an actorless workflow against the credentials its surface names', async () => {
    // A scheduled run has no subject on its principal, but the workflow it runs has
    // an owner, and the in-process surface passes that user. Without this a schedule
    // could not call an MCP block at all.
    await executeMcpToolUseCase.execute({
      principal: ACTORLESS_PRINCIPAL,
      input: {
        workspaceId: WORKSPACE.workspaceId,
        serverId: SERVER.id,
        toolName: 'lookup',
        credentialUserId: 'workflow-owner',
        arguments: { count: '2', enabled: 'true', tags: 'a,b' },
      },
    })

    expect(mocks.assertPermissionsAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'workflow-owner' })
    )
    // Discovery resolves the same person's OAuth credentials, so it must be told
    // the same user the permission gate was.
    expect(mocks.discoverServerTools.mock.calls[0][0]).toBe('workflow-owner')
  })

  it('ignores a named user when the principal already has one', async () => {
    // The property that keeps the fallback from becoming an impersonation handle:
    // it is consulted only when the principal names nobody.
    await executeMcpToolUseCase.execute({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE.workspaceId,
        serverId: SERVER.id,
        toolName: 'lookup',
        credentialUserId: 'someone-else',
        arguments: { count: '2', enabled: 'true', tags: 'a,b' },
      },
    })

    expect(mocks.assertPermissionsAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' })
    )
  })

  it('does not execute when schema validation fails', async () => {
    await expect(
      executeMcpToolUseCase.execute({
        principal: PRINCIPAL,
        input: {
          workspaceId: WORKSPACE.workspaceId,
          serverId: SERVER.id,
          toolName: 'lookup',
          arguments: { enabled: true },
        },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Invalid tool arguments' })

    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('never retries a submitted tool call after an ambiguous provider failure', async () => {
    mocks.executeTool.mockRejectedValueOnce(new Error('socket hang up'))

    await expect(
      executeMcpToolUseCase.execute({
        principal: PRINCIPAL,
        input: {
          workspaceId: WORKSPACE.workspaceId,
          serverId: SERVER.id,
          toolName: 'lookup',
          arguments: { count: 1 },
        },
      })
    ).rejects.toThrow('socket hang up')

    expect(mocks.executeTool).toHaveBeenCalledOnce()
  })
})
