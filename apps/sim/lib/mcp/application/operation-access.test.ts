/** @vitest-environment node */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadWorkflow } = vi.hoisted(() => ({ loadWorkflow: vi.fn() }))
vi.mock('@sim/workflow-persistence', () => ({ loadWorkflowFromNormalizedTablesRaw: loadWorkflow }))

import {
  loadMcpOperationAccess,
  requireMcpOperationAccess,
} from '@/lib/mcp/application/operation-access'

const principal: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:mcp-servers',
  issuedAt: new Date(),
  expiresAt: new Date('2099-01-01'),
  resourceScope: { mcpBlockId: 'block-1', mcpServerId: 'server-1' },
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    currentWorkflow: { mode: 'draft', workflowId: 'workflow-1' },
  },
}
const target = { workspaceId: 'workspace-1', serverId: 'server-1' }
const allowRead = { mode: 'allow', operations: [{ serverId: 'server-1', name: 'read' }] }

function savedBlock(type: string, values: Record<string, unknown>) {
  return {
    type,
    enabled: true,
    subBlocks: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }])),
  }
}
function save(type: string, values: Record<string, unknown>) {
  loadWorkflow.mockResolvedValue({
    workspaceId: 'workspace-1',
    blocks: { 'block-1': savedBlock(type, values) },
  })
}

describe('trusted MCP operation access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    save('agent', {
      tools: [
        {
          type: 'mcp-server-advanced',
          params: { serverId: 'server-1' },
          operationPolicy: allowRead,
        },
      ],
    })
  })

  it('loads restrictions from saved workflow state', async () => {
    const allowed = await loadMcpOperationAccess(principal, target)
    expect(allowed.allows('read')).toBe(true)
    expect(allowed.allows('write')).toBe(false)
    expect(() => requireMcpOperationAccess(allowed, 'write')).toThrow('not permitted')
  })

  it('allows all discovered operations for an unrestricted block', async () => {
    save('mcp', { server: 'server-1', operation: 'list', operationPolicy: { mode: 'all' } })
    const allowed = await loadMcpOperationAccess(principal, target)
    expect(allowed.allows('read')).toBe(true)
    expect(allowed.allows('write')).toBe(true)
  })

  it('does not apply workflow restrictions to an authorized editor catalog', async () => {
    const allowed = await loadMcpOperationAccess(
      { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      target
    )
    expect(allowed.allows('read')).toBe(true)
    expect(allowed.allows('write')).toBe(true)
    expect(loadWorkflow).not.toHaveBeenCalled()
  })

  it('resolves a dynamic connection and operation without a parent input', async () => {
    save('mcp', {
      server: '<previous.connection>',
      tool: '{{operation}}',
      operation: 'run',
      operationPolicy: allowRead,
    })
    const allowed = await loadMcpOperationAccess(
      principal,
      { ...target, connectionId: 'connection-1', assertedServerId: 'server-1' },
      'execute'
    )
    expect(allowed.allows('read')).toBe(true)
    expect(
      (
        await loadMcpOperationAccess(principal, {
          ...target,
          serverId: 'server-2',
          connectionId: 'connection-2',
        })
      ).allows('read')
    ).toBe(true)
    await expect(
      loadMcpOperationAccess(principal, {
        ...target,
        connectionId: 'connection-1',
        assertedServerId: 'server-2',
      })
    ).rejects.toThrow('does not belong')
  })

  it('rejects a different saved server or connection', async () => {
    save('mcp', { server: 'server-1', tool: 'read', operation: 'run' })
    await expect(
      loadMcpOperationAccess(principal, { ...target, serverId: 'server-2' })
    ).rejects.toThrow('saved block')
    save('mcp', { server: 'server-1', connection: 'connection-1', operation: 'list' })
    await expect(
      loadMcpOperationAccess(principal, { ...target, connectionId: 'connection-2' })
    ).rejects.toThrow('saved block')
  })

  it('requires JSON arguments when a fixed operation targets a dynamic server', async () => {
    save('mcp', { server: '<upstream.server>', tool: 'read', operationPolicy: allowRead })
    expect((await loadMcpOperationAccess(principal, target)).argumentsMode).toBe('json')
    save('mcp', { server: 'server-1', tool: 'read', operationPolicy: allowRead })
    expect((await loadMcpOperationAccess(principal, target)).argumentsMode).toBe('generated')
  })

  it.each(['agent', 'mothership'])(
    'applies the same policy to %s advanced bindings',
    async (type) => {
      save(type, {
        tools: [
          {
            type: 'mcp-server-advanced',
            params: { serverId: 'server-1', connectionId: '<connections.id>' },
            operationPolicy: allowRead,
          },
        ],
      })
      const allowed = await loadMcpOperationAccess(principal, {
        ...target,
        connectionId: 'connection-1',
      })
      expect(allowed.allows('read')).toBe(true)
      expect(allowed.allows('write')).toBe(false)
    }
  )

  it('keeps explicit tools bound to their saved names', async () => {
    save('agent', {
      tools: [
        {
          type: 'mcp',
          params: { serverId: 'server-1', toolName: 'read' },
          schema: { properties: {} },
        },
      ],
    })
    const allowed = await loadMcpOperationAccess(principal, target)
    expect(allowed.allows('read')).toBe(true)
    expect(allowed.allows('write')).toBe(false)
  })

  it('refuses ambiguous dynamic attachments that could widen a restriction', async () => {
    save('agent', {
      tools: [
        {
          type: 'mcp-server-advanced',
          params: { serverId: '<upstream.server>' },
          operationPolicy: allowRead,
        },
        {
          type: 'mcp-server-advanced',
          params: { serverId: 'server-1' },
          operationPolicy: { mode: 'all' },
        },
      ],
    })
    await expect(loadMcpOperationAccess(principal, target)).rejects.toThrow('overlapping')
  })

  it('does not accept attachment configuration from upstream inputs', async () => {
    save('agent', { tools: '<upstream.tools>' })
    await expect(loadMcpOperationAccess(principal, target)).rejects.toThrow('saved configuration')
    save('agent', {
      tools: [
        {
          type: 'mcp-server-advanced',
          params: { serverId: 'server-1' },
          operationPolicy: '<upstream.policy>',
        },
      ],
    })
    await expect(loadMcpOperationAccess(principal, target)).rejects.toThrow('Invalid MCP')
  })

  it('requires block provenance for direct executor calls', async () => {
    await expect(
      loadMcpOperationAccess({ ...principal, resourceScope: {} }, target)
    ).rejects.toThrow('provenance')
    expect(loadWorkflow).not.toHaveBeenCalled()
  })

  it('rejects wrong workspace, deleted blocks and disabled bindings', async () => {
    await expect(
      loadMcpOperationAccess(principal, { ...target, workspaceId: 'workspace-2' })
    ).rejects.toThrow('scope')
    loadWorkflow.mockResolvedValue({ workspaceId: 'workspace-1', blocks: {} })
    await expect(loadMcpOperationAccess(principal, target)).rejects.toThrow('missing or disabled')
    save('agent', {
      tools: [
        { type: 'mcp-server-advanced', params: { serverId: 'server-1' }, usageControl: 'none' },
      ],
    })
    await expect(loadMcpOperationAccess(principal, target)).rejects.toThrow('not configured')
  })

  it('uses the immutable deployment state rather than an edited draft', async () => {
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      { state: { blocks: { 'block-1': savedBlock('mcp', { server: 'server-1', tool: 'read' }) } } },
    ])
    const deployed = {
      ...principal,
      delegationContext: {
        ...principal.delegationContext,
        currentWorkflow: {
          mode: 'deployment' as const,
          workflowId: 'workflow-1',
          deploymentVersionId: 'version-1',
        },
      },
    }
    const allowed = await loadMcpOperationAccess(deployed, target)
    expect(allowed.allows('read')).toBe(true)
    expect(allowed.allows('write')).toBe(false)
    expect(loadWorkflow).not.toHaveBeenCalled()
  })

  it('normalizes legacy fixed tool IDs while preserving their exact operation', async () => {
    save('mcp', { server: 'server-1', tool: 'server-1-read' })
    const allowed = await loadMcpOperationAccess(principal, target)
    expect(allowed.allows('read')).toBe(true)
    expect(allowed.allows('write')).toBe(false)
  })

  it('allows empty list discovery but never execution from a list block', async () => {
    save('mcp', {
      server: 'server-1',
      operation: 'list',
      operationPolicy: { mode: 'allow', operations: [] },
    })
    expect((await loadMcpOperationAccess(principal, target)).allows('read')).toBe(true)
    await expect(loadMcpOperationAccess(principal, target, 'execute')).rejects.toThrow(
      'cannot execute'
    )
  })
  it('enforces active field values and advanced literal argument validation', async () => {
    const block = savedBlock('mcp', {
      operation: 'run',
      serverSelector: 'wrong-server',
      serverReference: 'server-1',
      toolSelector: 'wrong-operation',
      toolReference: 'read',
    })
    loadWorkflow.mockResolvedValue({
      workspaceId: 'workspace-1',
      blocks: {
        'block-1': { ...block, data: { canonicalModes: { server: 'advanced', tool: 'advanced' } } },
      },
    })
    const allowed = await loadMcpOperationAccess(principal, target, 'execute')
    expect(allowed.argumentsMode).toBe('json')
    expect(allowed.allows('read')).toBe(true)
    expect(allowed.allows('wrong-operation')).toBe(false)
    await expect(
      loadMcpOperationAccess(principal, { ...target, serverId: 'wrong-server' })
    ).rejects.toThrow('saved block')
  })

  it('does not treat a managed parent as authority to select any contributed credential', async () => {
    save('mcp', { server: 'server-1', operation: 'list' })
    await expect(
      loadMcpOperationAccess(principal, { ...target, connectionId: 'connection-1' })
    ).rejects.toThrow('saved block')
    save('agent', { tools: [{ type: 'mcp-server-advanced', params: { serverId: 'server-1' } }] })
    await expect(
      loadMcpOperationAccess(principal, { ...target, connectionId: 'connection-1' })
    ).rejects.toThrow('not configured')
  })
})
