import type { SubjectDelegatedPrincipal } from '@sim/auth/principal'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { mcpUseCasesMock, mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
import {
  mothershipChatPayloadMock,
  mothershipChatPayloadMockFns,
} from '@sim/testing/mocks/mothership-chat-payload.mock'
import {
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsQueriesMock,
  workflowsQueriesMockFns,
} from '@sim/testing/mocks/workflows-queries.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import type { BlockState } from '@sim/workflow-types/workflow'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'

const hoisted = vi.hoisted(() => ({
  custom: vi.fn(),
  skill: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/queries', () => workflowsQueriesMock)
vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  readAvailableCustomToolByIdOrTitleUseCase: {
    delegationAudience: 'sim:custom-tools',
    execute: hoisted.custom,
  },
}))
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)
vi.mock('@/lib/skills/application/use-cases', () => ({
  getSkillUseCase: { delegationAudience: 'sim:skills', execute: hoisted.skill },
}))
vi.mock('@/lib/mothership/chat/payload', () => mothershipChatPayloadMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)

import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { runEngine } from '@/lib/mothership/agent-cli/engines'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'
import { inspectWorkflowTools } from '@/lib/workflows/application/inspect-workflow-tools'
import { AgentBlock } from '@/blocks/blocks/agent'
import { MothershipBlock } from '@/blocks/blocks/mothership'
import { TableBlock } from '@/blocks/blocks/table'
import { ToolNotAllowedError } from '@/ee/access-control/utils/permission-check'
import { assignProviderToolIdentities } from '@/providers/tool-identity'
import { tools } from '@/tools/registry'
import { tableQueryRowsTool } from '@/tools/table/query_rows'

const mocks = {
  ...hoisted,
  snapshot: workflowsQueriesMockFns.mockLoadWorkflowReadSnapshot,
  mcp: mcpUseCasesMockFns.mockDiscoverMcpServerToolsUseCase,
  ambient: mothershipChatPayloadMockFns.mockBuildIntegrationToolSchemas,
}

Object.assign(tools, { table_query_rows: tableQueryRowsTool })

const mockBlockPermission = permissionCheckMockFns.mockValidateBlockType
const mockToolPermission = permissionCheckMockFns.mockAssertPermissionsAllowed

const mockGetBlock = getBlock as Mock
mockGetBlock.mockReturnValue(undefined)

const mockPermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockContext = workflowContextMockFns.mockResolveActiveWorkflowApplicationContext

let principal: SubjectDelegatedPrincipal
function save(
  type = 'agent',
  tools: unknown = [],
  extra: Partial<BlockState> = {},
  skills?: unknown
): void {
  const block = {
    id: 'agent',
    type,
    name: 'Alfred',
    position: { x: 0, y: 0 },
    enabled: true,
    outputs: {},
    subBlocks: {
      model: { id: 'model', type: 'dropdown', value: 'gpt-6-astra' },
      tools: { id: 'tools', type: 'tool-input', value: tools },
      ...(skills ? { skills: { id: 'skills', type: 'skill-input', value: skills } } : {}),
    },
    ...extra,
  }
  mocks.snapshot.mockResolvedValue({
    workflowRecord: { id: 'workflow' },
    normalizedData: { blocks: { agent: block }, edges: [], loops: {}, parallels: {} },
  })
}
function inspect(options: { query?: string; limit?: number; signal?: AbortSignal } = {}) {
  return inspectWorkflowTools.execute({
    principal,
    input: {
      workflowId: 'workflow',
      blockId: 'agent',
      assertedWorkspaceId: 'workspace',
      ...options,
    },
  })
}

describe('configured workflow tool inspection', () => {
  beforeEach(() => {
    principal = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'reader',
      workspaceId: 'workspace',
      audience: 'sim:workflows',
      delegationId: 'chat-tool',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }
    markCopilotWorkspaceInvocation(principal)
    mockContext.mockResolvedValue({
      workflowId: 'workflow',
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'payer',
      workflow: { id: 'workflow' },
    })
    mockPermission.mockResolvedValue('read')
    mocks.custom.mockResolvedValue({
      tool: { title: 'lookup_customer', schema: { function: { name: 'ignored_schema_alias' } } },
    })
    mocks.mcp.mockResolvedValue({ tools: [{ name: 'read' }, { name: 'write' }] })
    mocks.ambient.mockResolvedValue([
      {
        name: 'slack_send',
        service: 'slack',
        description: 'Send a message',
        input_schema: { privateMarker: 'not-returned' },
      },
      { name: 'gmail_read', service: 'gmail', description: 'Read email', input_schema: {} },
    ])
    mocks.skill.mockResolvedValue({ skill: { name: 'skill' } })
    mockToolPermission.mockResolvedValue(undefined)
    mockBlockPermission.mockResolvedValue(undefined)
    mockGetBlock.mockImplementation(
      (type: string) =>
        ({ agent: AgentBlock, mothership: MothershipBlock, table_v2: TableBlock })[type]
    )
    save()
  })

  it('uses actual runtime operation IDs and duplicate suffixes, never attachment labels', async () => {
    save('agent', [
      {
        type: 'table_v2',
        operation: 'query_rows',
        title: 'Search customers',
        params: { tableId: 'table-a' },
      },
      {
        type: 'table_v2',
        operation: 'query_rows',
        title: 'Search invoices',
        params: { tableId: 'table-b' },
      },
    ])
    const result = await inspect()
    const runtime = [{ id: 'table_query_rows' }, { id: 'table_query_rows' }]
    assignProviderToolIdentities(runtime)
    expect(result.selected.map((tool) => tool.callableName)).toEqual(runtime.map((tool) => tool.id))
    expect(result.selected[0].fixedArgumentNames).toEqual(['tableId'])
    expect(result.selected[0].displayTitle).toBe('Search customers')
    expect(JSON.stringify(result)).not.toContain('table-a')
    expect(result.approval.enforcedPerCall).toBe(false)
    expect(result.exposure).toBe('direct')
    expect(result.ambient).toBeUndefined()
  })

  it('does not discover disabled tools, even when their references are dynamic', async () => {
    save('agent', [
      {
        type: 'mcp',
        usageControl: 'none',
        params: { serverId: '<start.server>', toolName: 'write' },
      },
    ])
    expect((await inspect()).selected[0].status).toBe('disabled')
    expect(mocks.mcp).not.toHaveBeenCalled()
  })

  it('respects variable permission modes and withholds uncertain duplicate aliases', async () => {
    save(
      'agent',
      [
        {
          type: 'table_v2',
          operation: 'query_rows',
          usageControl: 'auto',
          usageControlExpression: '<start.mode>',
        },
        { type: 'table_v2', operation: 'query_rows' },
      ],
      { data: { canonicalModes: { '0:agentToolUsageControl': 'advanced' } } }
    )
    const result = await inspect()
    expect(result.selected[0].status).toBe('unresolved')
    expect(result.selected[1].canonicalName).toBe('table_query_rows')
    expect(result.selected[1].callableName).toBeUndefined()
  })

  it('checks selected MCP operations once per server and applies saved server policies', async () => {
    save('agent', [
      { type: 'mcp', params: { serverId: 'first', toolName: 'read' } },
      { type: 'mcp', params: { serverId: 'first', toolName: 'write' } },
      {
        type: 'mcp-server-advanced',
        params: { serverId: 'second' },
        operationPolicy: { mode: 'deny', operations: ['write'] },
      },
    ])
    const result = await inspect()
    expect(result.selected.map((tool) => tool.callableName)).toEqual([
      'mcp-first-read',
      'mcp-first-write',
      'mcp-second-read',
    ])
    expect(mocks.mcp).toHaveBeenCalledTimes(2)
    expect(result.selected[2].fixedArgumentNames).toBeUndefined()
    expect(mocks.mcp.mock.calls[0][0]).toMatchObject({
      principal: { subjectUserId: 'reader', audience: 'sim:mcp-servers' },
      input: { serverId: 'first', workspaceId: 'workspace', requireComplete: true },
    })
  })

  it('does not offer missing MCP operations or overlapping server bindings', async () => {
    save('agent', [{ type: 'mcp', params: { serverId: 'server', toolName: 'unknown' } }])
    expect((await inspect()).selected[0].status).toBe('unavailable')
    save('agent', [
      { type: 'mcp', params: { serverId: 'server', toolName: 'read' } },
      { type: 'mcp-server-advanced', params: { serverId: 'server' } },
    ])
    expect((await inspect()).selected.every((tool) => tool.status === 'unavailable')).toBe(true)
  })

  it('exposes ambient Sim Chat integrations with no selections, filters without schemas', async () => {
    save('mothership')
    const result = await inspect({ query: 'slack', limit: 1 })
    expect(result).toMatchObject({
      selectionMode: 'additive',
      exposure: 'integration_gateway',
      selected: [],
      ambient: {
        total: 1,
        truncated: false,
        operations: [{ toolId: 'slack_send', service: 'slack' }],
      },
    })
    expect(mocks.ambient).toHaveBeenCalledExactlyOnceWith(
      'reader',
      { schemaSurface: 'copilot' },
      'workspace'
    )
    expect(JSON.stringify(result)).not.toContain('privateMarker')
    const limited = await inspect({ limit: 1 })
    expect(limited.ambient).toMatchObject({ total: 2, truncated: true })
    expect((await inspect({ limit: 0 })).ambient?.operations).toHaveLength(2)
  })

  it('does not confuse Sim Chat MCP additions with an integration allowlist', async () => {
    save('mothership', [
      {
        type: 'mcp',
        usageControl: 'force',
        params: { serverId: 'server', toolName: 'read', secret: 'never-return' },
      },
      { type: 'table_v2', operation: 'query_rows' },
    ])
    const result = await inspect()
    expect(result.selected[0]).toMatchObject({
      callableName: 'mcp-server-read',
      usageControl: 'force',
    })
    expect(result.selected[0].fixedArgumentNames).toBeUndefined()
    expect(result.selected[1].status).toBe('unavailable')
    expect(result.ambient?.total).toBe(2)
    expect(JSON.stringify(result)).not.toContain('never-return')
  })

  it.each(['<start.mode>', 'none'])(
    'reports Sim Chat variable mode %s without discovering disabled or unresolved tools',
    async (usageControlExpression) => {
      save(
        'mothership',
        [
          {
            type: 'mcp',
            usageControl: 'force',
            usageControlExpression,
            params: { serverId: 'server', toolName: 'read' },
          },
        ],
        { data: { canonicalModes: { '0:agentToolUsageControl': 'advanced' } } }
      )
      expect((await inspect()).selected[0].status).toBe(
        usageControlExpression === 'none' ? 'disabled' : 'unresolved'
      )
      expect(mocks.mcp).not.toHaveBeenCalled()
    }
  )

  it('round-trips through the registered CLI engine using the trusted invocation subject', async () => {
    save('mothership', [{ type: 'mcp', params: { serverId: 'server', toolName: 'read' } }])
    const runtime: AgentCliRuntime = {
      workspaceId: 'workspace',
      userId: 'reader',
      invocation: { userId: 'reader', workspaceId: 'workspace', chatId: 'chat' },
      client: { request: vi.fn() },
    }
    const result = await runEngine('workflows tools', ['workflow'], runtime, {
      block: 'agent',
      query: 'slack',
      limit: '1',
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      workspaceId: 'workspace',
      ambient: { operations: [{ toolId: 'slack_send', service: 'slack' }] },
      selected: [{ callableName: 'mcp-server-read' }],
    })
    expect(mocks.mcp.mock.calls[0][0].principal).toMatchObject({
      subjectUserId: 'reader',
      workspaceId: 'workspace',
      audience: 'sim:mcp-servers',
    })
    expect(runtime.client.request).not.toHaveBeenCalled()
    expect(result.stdout).not.toContain('input_schema')
    mocks.snapshot.mockRejectedValueOnce(new Error('private database address'))
    const failed = await runEngine('workflows tools', ['workflow'], runtime, { block: 'agent' })
    expect(failed.exitCode).toBe(1)
    expect(failed.stdout).toBe('')
    expect(failed.stderr).not.toContain('private database address')
    expect(failed.stderr).toContain('could not complete')
  })

  it('validates required engine inputs and rejects invalid limits before loading the graph', async () => {
    const runtime: AgentCliRuntime = {
      workspaceId: 'workspace',
      userId: 'reader',
      principal,
      client: { request: vi.fn() },
    }
    expect((await runEngine('workflows tools', ['workflow'], runtime, {})).stderr).toContain(
      '--block'
    )
    expect((await runEngine('workflows tools', [], runtime, { block: 'agent' })).exitCode).toBe(1)
    expect(
      (await runEngine('workflows tools', ['workflow'], runtime, { block: 'agent', limit: '-1' }))
        .exitCode
    ).toBe(1)
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('reports denied tools but propagates infrastructure failures instead of false absence', async () => {
    save('agent', [{ type: 'table_v2', operation: 'query_rows' }])
    mockToolPermission.mockRejectedValue(new ToolNotAllowedError('table_query_rows'))
    expect((await inspect()).selected[0].status).toBe('unavailable')
    mockToolPermission.mockRejectedValue(new Error('database offline'))
    await expect(inspect()).rejects.toThrow('database offline')
  })

  it('authorizes the workflow before loading its graph', async () => {
    mockPermission.mockResolvedValue(null)
    await expect(inspect()).rejects.toThrow('Insufficient workspace permissions')
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.ambient).not.toHaveBeenCalled()
  })

  it('rejects wrong workspace, expired delegation and unsupported principals', async () => {
    mockContext.mockResolvedValue({
      workflowId: 'workflow',
      workspaceId: 'elsewhere',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    })
    await expect(inspect()).rejects.toThrow('Delegated workspace access')
    expect(mocks.snapshot).not.toHaveBeenCalled()
    principal.expiresAt = new Date(0)
    await expect(inspect()).rejects.toThrow('Delegated workspace access')
    await expect(
      inspectWorkflowTools.execute({
        principal: createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }),
        input: { workflowId: 'workflow', blockId: 'agent' },
      })
    ).rejects.toThrow('Workspace API key cannot')
  })

  it('fails cancelled and unsupported-block requests without inventory discovery', async () => {
    await expect(inspect({ signal: AbortSignal.abort() })).rejects.toThrow()
    expect(mocks.snapshot).not.toHaveBeenCalled()
    save('function')
    await expect(inspect()).rejects.toThrow('Agent and Sim Chat')
    expect(mocks.mcp).not.toHaveBeenCalled()
    expect(mocks.ambient).not.toHaveBeenCalled()
  })
})
