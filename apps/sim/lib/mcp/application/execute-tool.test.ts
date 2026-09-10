/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkflow: vi.fn(),
  loadContext: vi.fn(),
  getServer: vi.fn(),
  resolvePermission: vi.fn(),
  assertPermissionsAllowed: vi.fn(),
  discoverServerTools: vi.fn(),
  executeTool: vi.fn(),
  telemetry: vi.fn(),
}))

vi.mock('@sim/workflow-persistence', () => ({
  loadWorkflowFromNormalizedTablesRaw: mocks.loadWorkflow,
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
  resourceScope: { mcpServerId: SERVER.id, mcpBlockId: 'block-1' },
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
  resourceScope: { mcpServerId: SERVER.id, mcpBlockId: 'block-1' },
}
const COMPATIBILITY_ACTOR_PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  ...ACTORLESS_PRINCIPAL,
  delegationContext: {
    ...ACTORLESS_PRINCIPAL.delegationContext,
    compatibilityActor: {
      kind: 'legacy_execution_user',
      userId: 'execution-actor',
    },
  },
}

describe('executeMcpToolUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    const savedWorkflow = {
      workspaceId: 'workspace-1',
      blocks: {
        'block-1': {
          type: 'mcp',
          enabled: true,
          subBlocks: { server: { value: SERVER.id }, tool: { value: 'lookup' } },
        },
      },
    }
    mocks.loadWorkflow.mockResolvedValue(savedWorkflow)
    queueTableRows(schemaMock.workflowDeploymentVersion, [{ state: savedWorkflow }])
    queueTableRows(schemaMock.workflowDeploymentVersion, [{ state: savedWorkflow }])
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

  it('does not infer a managed credential from the execution actor', async () => {
    mocks.getServer.mockResolvedValueOnce({ ...SERVER, credentialGroupId: 'group-1' })

    await expect(
      executeMcpToolUseCase.execute({
        principal: PRINCIPAL,
        input: {
          workspaceId: WORKSPACE.workspaceId,
          serverId: SERVER.id,
          toolName: 'lookup',
        },
      })
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'Credential Group MCP servers require an explicit managed connection ID',
    })

    expect(mocks.assertPermissionsAllowed).not.toHaveBeenCalled()
    expect(mocks.discoverServerTools).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('keeps an unattended run connecting as its execution actor', async () => {
    // Pre-in-process behavior: the executor minted an internal token from
    // ExecutionContext.userId and MCP ran as that user. Preserved deliberately —
    // see requireMcpCredentialUserId for why that actor is the payer, not the author.
    await executeMcpToolUseCase.execute({
      principal: COMPATIBILITY_ACTOR_PRINCIPAL,
      input: {
        workspaceId: WORKSPACE.workspaceId,
        serverId: SERVER.id,
        toolName: 'lookup',
        arguments: { count: '2', enabled: 'true', tags: 'a,b' },
      },
    })

    expect(mocks.assertPermissionsAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'execution-actor' })
    )
    expect(mocks.discoverServerTools.mock.calls[0][0]).toBe('execution-actor')
  })

  it('lets an authenticated subject win over a principal-bound compatibility actor', async () => {
    await executeMcpToolUseCase.execute({
      principal: {
        ...PRINCIPAL,
        delegationContext: {
          ...PRINCIPAL.delegationContext,
          compatibilityActor: {
            kind: 'legacy_execution_user',
            userId: 'someone-else',
          },
        },
      },
      input: {
        workspaceId: WORKSPACE.workspaceId,
        serverId: SERVER.id,
        toolName: 'lookup',
        arguments: { count: '2', enabled: 'true', tags: 'a,b' },
      },
    })

    expect(mocks.assertPermissionsAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' })
    )
  })

  it('keeps an external-subject webhook connecting as the execution actor', async () => {
    // A webhook's external_user subject is a real identity but never a Sim user, so
    // it has no Sim credentials of its own and these runs have always connected as
    // the actor. Refusing here would break workflows that worked before the tools
    // moved in-process, so the fallback deliberately covers this case.
    const externalSubjectPrincipal = {
      ...COMPATIBILITY_ACTOR_PRINCIPAL,
      delegationContext: {
        ...COMPATIBILITY_ACTOR_PRINCIPAL.delegationContext,
        principal: {
          kind: 'system' as const,
          serviceId: 'webhook' as const,
          workspaceId: WORKSPACE.workspaceId,
          workflowId: 'workflow-1',
          webhookId: 'webhook-1',
          provider: 'slack',
          subject: {
            kind: 'external_user' as const,
            provider: 'slack',
            tenantId: 'T1',
            subjectId: 'U1',
          },
        },
      },
    }

    await executeMcpToolUseCase.execute({
      principal: externalSubjectPrincipal,
      input: {
        workspaceId: WORKSPACE.workspaceId,
        serverId: SERVER.id,
        toolName: 'lookup',
        arguments: { count: '2', enabled: 'true', tags: 'a,b' },
      },
    })

    expect(mocks.assertPermissionsAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'execution-actor' })
    )
  })

  it('refuses when the run names no user and carries no actor either', async () => {
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
      message: 'MCP servers are reached with a user\u2019s own credentials, and this run has none',
    })

    expect(mocks.assertPermissionsAllowed).not.toHaveBeenCalled()
    expect(mocks.discoverServerTools).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
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
    ).rejects.toMatchObject({ code: 'validation', message: 'Invalid MCP operation arguments' })

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

  it('does not execute after discovery fails or loses the requested operation', async () => {
    const input = {
      workspaceId: WORKSPACE.workspaceId,
      serverId: SERVER.id,
      toolName: 'lookup',
      arguments: { count: 1 },
    }
    mocks.discoverServerTools.mockRejectedValueOnce(new Error('incomplete discovery'))
    await expect(executeMcpToolUseCase.execute({ principal: PRINCIPAL, input })).rejects.toThrow(
      'incomplete discovery'
    )
    mocks.discoverServerTools.mockResolvedValueOnce([])
    await expect(executeMcpToolUseCase.execute({ principal: PRINCIPAL, input })).rejects.toThrow(
      'Tool not found'
    )
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('rechecks a saved block restriction changed during discovery', async () => {
    mocks.loadWorkflow.mockResolvedValueOnce(await mocks.loadWorkflow()).mockResolvedValue({
      workspaceId: WORKSPACE.workspaceId,
      blocks: {
        'block-1': {
          type: 'agent',
          subBlocks: {
            tools: {
              value: [
                {
                  type: 'mcp-server-advanced',
                  params: { serverId: SERVER.id },
                  operationPolicy: { mode: 'allow', operations: [] },
                },
              ],
            },
          },
        },
      },
    })
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
    ).rejects.toThrow('not permitted')
    expect(mocks.discoverServerTools).toHaveBeenCalledWith(
      'user-1',
      SERVER.id,
      WORKSPACE.workspaceId,
      'skip-cache',
      undefined,
      { signal: undefined, requireComplete: true }
    )
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it.each(['<upstream.operation>', 'lookup'])(
    'validates Advanced JSON arguments for %s without generated-field coercion',
    async (tool) => {
      mocks.loadWorkflow.mockResolvedValue({
        workspaceId: WORKSPACE.workspaceId,
        blocks: {
          'block-1': {
            type: 'mcp',
            data: { canonicalModes: { server: 'basic', tool: 'advanced' } },
            subBlocks: {
              serverSelector: { value: SERVER.id },
              operation: { value: 'run' },
              toolReference: { value: tool },
            },
          },
        },
      })
      const input = {
        workspaceId: WORKSPACE.workspaceId,
        serverId: SERVER.id,
        toolName: 'lookup',
        arguments: { count: '2' },
      }
      await expect(executeMcpToolUseCase.execute({ principal: PRINCIPAL, input })).rejects.toThrow(
        'Invalid MCP operation arguments'
      )
      expect(mocks.executeTool).not.toHaveBeenCalled()
      await expect(
        executeMcpToolUseCase.execute({
          principal: PRINCIPAL,
          input: { ...input, arguments: { count: 2 } },
        })
      ).resolves.toMatchObject({ success: true })
    }
  )

  it('rejects restricted calls before discovery and rejects forged block scope', async () => {
    const input = {
      workspaceId: WORKSPACE.workspaceId,
      serverId: SERVER.id,
      toolName: 'lookup',
      arguments: { count: 1 },
    }
    mocks.loadWorkflow.mockResolvedValue({
      workspaceId: WORKSPACE.workspaceId,
      blocks: {
        'block-1': {
          type: 'agent',
          subBlocks: {
            tools: {
              value: [
                {
                  type: 'mcp-server-advanced',
                  params: { serverId: SERVER.id },
                  operationPolicy: {
                    mode: 'deny',
                    operations: [{ serverId: SERVER.id, name: 'lookup' }],
                  },
                },
              ],
            },
          },
        },
      },
    })
    await expect(executeMcpToolUseCase.execute({ principal: PRINCIPAL, input })).rejects.toThrow(
      'not permitted'
    )
    await expect(
      executeMcpToolUseCase.execute({
        principal: { ...PRINCIPAL, resourceScope: { mcpServerId: SERVER.id } },
        input,
      })
    ).rejects.toThrow('provenance')
    expect(mocks.discoverServerTools).not.toHaveBeenCalled()
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })
})
