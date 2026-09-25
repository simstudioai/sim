import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { createBlock } from '@sim/testing/factories'
import {
  blocksMock,
  createMockGetBlock,
  toolsMetadataMock,
  toolsUtilsMock,
} from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { listMcpOperations } from '@/lib/internal/mcp/list-operations'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { McpBlock } from '@/blocks/blocks/mcp'
import { ExecutionState } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
import { VariableResolver } from '@/executor/variables/resolver'
import { Serializer } from '@/serializer'
import { mcpListOperationsTool } from '@/tools/mcp/list-operations'
import { mcpRunOperationTool } from '@/tools/mcp/run-operation'
import type { McpListOperationsResponse } from '@/tools/mcp/types'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  discover: vi.fn(),
  executeUseCase: vi.fn(),
  executeManagedUseCase: vi.fn(),
}))

vi.mock('@/blocks', () => ({ ...blocksMock, getBlock: createMockGetBlock({ mcp: McpBlock }) }))
vi.mock('@/tools/utils', () => toolsUtilsMock)
vi.mock('@/tools/metadata', () => toolsMetadataMock)
vi.mock('@/lib/internal/mcp/discover-tools', () => ({
  discoverMcpServerToolsAsExecutor: mocks.discover,
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))
vi.mock('@/lib/mcp/application/execute-tool', () => ({
  executeMcpToolUseCase: { execute: mocks.executeUseCase },
  McpToolsNotAllowedError: class McpToolsNotAllowedError extends Error {},
}))
vi.mock('@/lib/mcp/application/execute-managed-tool', () => ({
  executeManagedMcpToolUseCase: { execute: mocks.executeManagedUseCase },
}))

import { executeMcpTool } from '@/lib/internal/mcp/execute-tool'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:mcp-servers',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2099-08-27T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}
const NESTED_HUMAN_PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-nested-human',
  audience: 'sim:mcp-servers',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2099-08-27T00:05:00.000Z'),
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    principal: { kind: 'session', userId: 'user-origin', sessionId: 'session-origin' },
  },
}
const BILLING = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'user-1',
  billingEntity: { type: 'user', id: 'user-1' },
  billingPeriod: { start: '2026-08-01', end: '2026-09-01' },
  payerSubscription: null,
} as unknown as BillingAttributionSnapshot
const CONTEXT: InternalToolOperationContext = {
  mcpBlockId: 'block-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  billingAttribution: BILLING,
  callChain: ['workflow-parent'],
}

describe('executeMcpTool', () => {
  beforeEach(() => {
    mocks.createPrincipal.mockResolvedValue(PRINCIPAL)
    mocks.executeUseCase.mockResolvedValue({
      success: true,
      output: { content: [{ type: 'text', text: 'done' }] },
    })
  })

  it.each(['', 'workflow-1'])(
    'uses the authenticated chat subject for a Copilot call with workflowId %j',
    async (workflowId) => {
      const response = await executeMcpTool({
        toolId: 'mcp-server-lookup',
        input: { query: 'sim', _context: { userId: 'forged', workspaceId: 'foreign' } },
        headers: new Headers(),
        context: {
          ...CONTEXT,
          workflowId,
          mcpBlockId: undefined,
          copilotToolExecution: true,
          copilotInteractionMode: 'interactive',
          chatId: 'chat-1',
          toolCallId: 'call-1',
        },
        requestId: 'request-copilot',
      })
      expect(response.status).toBe(200)
      expect(mocks.createPrincipal).not.toHaveBeenCalled()
      expect(mocks.executeUseCase).toHaveBeenCalledWith({
        principal: expect.objectContaining({
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'user-1',
          workspaceId: 'workspace-1',
          audience: 'sim:mcp-servers',
          delegationId: 'copilot-tool:call-1',
          resourceScope: { chatId: 'chat-1', mcpServerId: 'mcp-server' },
        }),
        input: expect.objectContaining({ arguments: { query: 'sim' } }),
      })
    }
  )

  it('binds a managed MCP connection to the authenticated chat subject', async () => {
    const credentialId = 'mcp-cg-123456789012345678901'
    mocks.executeManagedUseCase.mockResolvedValueOnce({ success: true, output: {} })
    const response = await executeMcpTool({
      toolId: `${credentialId}-lookup`,
      input: { query: 'sim', _context: { userId: 'forged' } },
      headers: new Headers(),
      context: {
        ...CONTEXT,
        workflowId: '',
        mcpBlockId: undefined,
        copilotToolExecution: true,
        chatId: 'chat-1',
        toolCallId: 'call-1',
      },
      requestId: 'request-copilot-managed',
    })
    expect(response.status).toBe(200)
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
    expect(mocks.executeUseCase).not.toHaveBeenCalled()
    expect(mocks.executeManagedUseCase).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        audience: 'sim:managed-mcp-credentials',
        resourceScope: { chatId: 'chat-1', credentialId },
      }),
      input: expect.objectContaining({
        credentialId,
        toolName: 'lookup',
        arguments: { query: 'sim' },
      }),
    })
  })

  it.each(['userId', 'toolCallId'] as const)(
    'rejects incomplete trusted Copilot context without %s',
    async (field) => {
      const response = await executeMcpTool({
        toolId: 'mcp-server-lookup',
        input: { _context: { userId: 'forged', toolCallId: 'forged-call' } },
        headers: new Headers(),
        context: {
          ...CONTEXT,
          workflowId: '',
          mcpBlockId: undefined,
          copilotToolExecution: true,
          toolCallId: 'call-1',
          [field]: undefined,
        },
        requestId: 'request-copilot',
      })
      expect(response.ok).toBe(false)
      expect(mocks.executeUseCase).not.toHaveBeenCalled()
      expect(mocks.createPrincipal).not.toHaveBeenCalled()
    }
  )

  it('retains executor authority for a Copilot call with saved MCP block provenance', async () => {
    const context = {
      ...CONTEXT,
      copilotToolExecution: true,
      copilotInteractionMode: 'interactive' as const,
      chatId: 'chat-1',
      toolCallId: 'call-1',
    }
    const response = await executeMcpTool({
      toolId: 'mcp-server-lookup',
      input: { arguments: { query: 'sim' } },
      headers: new Headers(),
      context,
      requestId: 'request-copilot-block',
    })
    expect(response.status).toBe(200)
    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context,
      audience: 'sim:mcp-servers',
      resourceScope: { mcpServerId: 'mcp-server' },
    })
    expect(mocks.executeUseCase).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ serverId: 'mcp-server', arguments: { query: 'sim' } }),
    })
  })

  it('filters framework parameters for Agent-originated arguments', async () => {
    await executeMcpTool({
      toolId: 'mcp-server-lookup',
      input: { query: 'sim', serverId: 'untrusted', _context: { workspaceId: 'foreign' } },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(mocks.executeUseCase).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ arguments: { query: 'sim' } }),
    })
  })

  it('resolves a connection ID directly through the managed application boundary', async () => {
    const credentialId = 'mcp-cg-123456789012345678901'
    mocks.executeManagedUseCase.mockResolvedValue({ success: true, output: { content: [] } })
    const response = await executeMcpTool({
      toolId: 'mcp_run_operation',
      input: { server: credentialId, tool: 'read', arguments: {} },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })
    expect(response.status).toBe(200)
    expect(mocks.executeManagedUseCase).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        credentialId,
        toolName: 'read',
      }),
    })
    expect(mocks.executeUseCase).not.toHaveBeenCalled()
  })

  it('rejects an empty resolved server without choosing a credential', async () => {
    const response = await executeMcpTool({
      toolId: 'mcp_run_operation',
      input: {
        server: '',
        tool: 'read',
        arguments: {},
      },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })
    expect(response.status).toBe(400)
    expect(mocks.executeManagedUseCase).not.toHaveBeenCalled()
    expect(mocks.executeUseCase).not.toHaveBeenCalled()
  })

  it('fails closed without trusted workspace or billing context', async () => {
    const missingWorkspace = await executeMcpTool({
      toolId: 'mcp-server-lookup',
      input: {},
      headers: new Headers(),
      context: { ...CONTEXT, workspaceId: undefined },
      requestId: 'request-1',
    })
    expect(missingWorkspace.status).toBe(400)
    expect(await missingWorkspace.json()).toMatchObject({
      error: 'Missing workspaceId in execution context for MCP tool lookup',
    })

    const missingBilling = await executeMcpTool({
      toolId: 'mcp-server-lookup',
      input: {},
      headers: new Headers(),
      context: { ...CONTEXT, billingAttribution: undefined },
      requestId: 'request-1',
    })
    expect(missingBilling.status).toBe(400)
    expect(await missingBilling.json()).toMatchObject({
      error: 'Missing billing attribution in execution context for MCP tool lookup',
    })
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
  })

  it('scopes provenance to the trusted nested human without inventing an actor', async () => {
    mocks.createPrincipal.mockResolvedValueOnce(NESTED_HUMAN_PRINCIPAL)
    mocks.executeUseCase.mockImplementationOnce(async ({ input }) => {
      input.onResolvedSecretTraceProvenance?.({
        version: 1,
        complete: true,
        entries: [],
        scope: { userId: 'user-origin', workspaceId: 'workspace-1' },
      })
      return { success: true, output: {} }
    })
    const importCrossingProvenance = vi.fn().mockResolvedValue(true)
    const fork = { importCrossingProvenance }
    const registry = {
      forkForToolCall: vi.fn(() => fork),
      mergeToolCallRegistry: vi.fn(),
    }

    const response = await executeMcpTool({
      toolId: 'mcp-server-lookup',
      input: {},
      headers: new Headers(),
      context: {
        ...CONTEXT,
        userId: undefined,
        resolvedSecretTraceRegistry: registry as never,
      },
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(mocks.executeUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ principal: NESTED_HUMAN_PRINCIPAL })
    )
    expect(importCrossingProvenance).toHaveBeenCalledWith(
      expect.objectContaining({
        complete: true,
        scope: { userId: 'user-origin', workspaceId: 'workspace-1' },
      }),
      expect.objectContaining({ success: true }),
      { trusted: true, origin: 'tool.mcp-server-lookup' }
    )
  })
  it.each(['server-1', 'mcp-cg-123456789012345678901'])(
    'executes connection lookup → List → Run using only %s and the returned name',
    async (targetId) => {
      mocks.executeManagedUseCase.mockResolvedValue({ success: true, output: { content: [] } })
      mocks.discover.mockResolvedValue([
        {
          name: 'exact_operation',
          description: 'Discovered',
          serverId: targetId,
          canonicalServerId: 'internal-parent',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ])
      const list = createBlock({
        id: 'list',
        name: 'List',
        type: 'mcp',
        data: { canonicalModes: { server: 'advanced', tool: 'advanced' } },
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'list' },
          serverReference: { id: 'serverReference', type: 'short-input', value: '<lookup.id>' },
        },
      })
      const run = createBlock({
        id: 'run',
        name: 'Run',
        type: 'mcp',
        data: { canonicalModes: { server: 'advanced', tool: 'advanced' } },
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'run' },
          serverReference: { id: 'serverReference', type: 'short-input', value: '<list.serverId>' },
          toolReference: {
            id: 'toolReference',
            type: 'short-input',
            value: '<list.operations.0.name>',
          },
          arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '<lookup.arguments>' },
        },
      })
      const lookup = createBlock({ id: 'lookup', name: 'Lookup', type: 'starter' })
      const workflow = new Serializer().serializeWorkflow({ lookup, list, run }, [], {})
      const listBlock = workflow.blocks.find((block) => block.id === 'list')!
      const runBlock = workflow.blocks.find((block) => block.id === 'run')!
      expect(listBlock.config.tool).toBe('mcp_list_operations')
      expect(runBlock.config.tool).toBe('mcp_run_operation')
      const state = new ExecutionState()
      state.setBlockOutput('lookup', { id: targetId, arguments: { query: 'sim' } })
      const ctx: ExecutionContext = {
        workflowId: CONTEXT.workflowId,
        blockStates: state.getBlockStates(),
        blockLogs: [],
        environmentVariables: {},
        decisions: { router: new Map(), condition: new Map() },
        loopExecutions: new Map(),
        executedBlocks: new Set(),
        completedLoops: new Set(),
        activeExecutionPath: new Set(),
        metadata: { duration: 0 },
      }
      const resolver = new VariableResolver(workflow, {}, state)
      const listParams = await resolver.resolveInputs(
        ctx,
        'list',
        listBlock.config.params,
        listBlock
      )
      const listResponse = await listMcpOperations({
        toolId: listBlock.config.tool,
        context: { ...CONTEXT, mcpBlockId: 'list' },
        headers: new Headers(),
        requestId: 'list-request',
        input: mcpListOperationsTool.operation.input({ server: listParams.server }),
      })
      const catalog = (await listResponse.json()) as McpListOperationsResponse
      expect(catalog.output.serverId).toBe(targetId)
      expect(catalog.output.operations[0]).toEqual({
        name: 'exact_operation',
        description: 'Discovered',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      })
      expect(mocks.executeUseCase).not.toHaveBeenCalled()
      expect(mocks.executeManagedUseCase).not.toHaveBeenCalled()
      state.setBlockOutput('list', catalog.output)
      const runParams = await resolver.resolveInputs(ctx, 'run', runBlock.config.params, runBlock)
      const response = await executeMcpTool({
        toolId: runBlock.config.tool,
        context: { ...CONTEXT, mcpBlockId: 'run' },
        headers: new Headers(),
        requestId: 'run-request',
        input: mcpRunOperationTool.operation.input({
          server: runParams.server,
          tool: runParams.tool,
          arguments: runParams.arguments,
        }),
      })
      expect(response.status).toBe(200)
      const execute = targetId.startsWith('mcp-cg-')
        ? mocks.executeManagedUseCase
        : mocks.executeUseCase
      expect(execute).toHaveBeenCalledWith({
        principal: PRINCIPAL,
        input: expect.objectContaining({
          ...(targetId.startsWith('mcp-cg-') ? { credentialId: targetId } : { serverId: targetId }),
          toolName: 'exact_operation',
          arguments: { query: 'sim' },
        }),
      })
      expect(mocks.createPrincipal).toHaveBeenCalledWith(
        expect.objectContaining({ context: expect.objectContaining({ mcpBlockId: 'run' }) })
      )
    }
  )
})
