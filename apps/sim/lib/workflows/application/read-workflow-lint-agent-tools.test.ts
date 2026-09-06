/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  snapshot: vi.fn(),
  selector: vi.fn(),
  customTools: vi.fn(),
  skill: vi.fn(),
  server: vi.fn(),
  discover: vi.fn(),
  oldCustomTool: vi.fn(),
  oldSkill: vi.fn(),
  secrets: vi.fn(),
  block: vi.fn((type: string) => ({ type, name: type, outputs: {}, subBlocks: [] })),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.context,
}))
vi.mock('@/lib/workflows/queries', () => ({ loadWorkflowReadSnapshot: mocks.snapshot }))
vi.mock('@/lib/workflows/editing/selector-validator', () => ({
  validateSelectorIds: mocks.selector,
}))
vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  getCustomToolById: mocks.oldCustomTool,
}))
vi.mock('@/lib/workflows/skills/operations', () => ({ getSkillById: mocks.oldSkill }))
vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  listAvailableCustomToolsUseCase: { execute: mocks.customTools },
}))
vi.mock('@/lib/skills/application/use-cases', () => ({ getSkillUseCase: { execute: mocks.skill } }))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  getMcpServerUseCase: { execute: mocks.server },
  discoverMcpServerToolsUseCase: { execute: mocks.discover },
}))
vi.mock('@/lib/table/service', () => ({ getTableById: vi.fn() }))
vi.mock('@/lib/secrets/application/use-cases', () => ({
  listSecretsUseCase: { execute: mocks.secrets },
}))
vi.mock('@/blocks/utils', () => ({ getModelOptions: vi.fn(() => []) }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
vi.mock('@/blocks/registry', () => ({ getBlock: mocks.block }))
vi.mock('@/blocks', () => ({ getBlock: mocks.block }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readWorkflowLint } from '@/lib/workflows/application/read-workflow-lint'

const principal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const workspaceId = 'parent-workspace'
const scope = {
  workspaceId,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
  workflowId: 'parent',
  workflow: { id: 'parent', workspaceId },
}
type ReferenceKind = 'custom-tool' | 'mcp-tool' | 'skill'

function setGraph(kind: ReferenceKind, ids: string[]) {
  const entries = ids.map((id) =>
    kind === 'skill'
      ? { skillId: id }
      : kind === 'custom-tool'
        ? { type: 'custom-tool', customToolId: id }
        : { type: 'mcp', params: { serverId: id, toolName: 'lookup' } }
  )
  const field = kind === 'skill' ? 'skills' : 'tools'
  const graph = {
    blocks: {
      agent: {
        id: 'agent',
        type: 'agent',
        name: 'Agent',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: { [field]: { value: entries } },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
  mocks.snapshot.mockResolvedValue({ workflowRecord: scope.workflow, normalizedData: graph })
  return graph
}

function lookup(kind: ReferenceKind) {
  return kind === 'custom-tool' ? mocks.customTools : kind === 'skill' ? mocks.skill : mocks.server
}

describe('standalone agent-tool reference diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.mockResolvedValue(scope)
    mocks.permission.mockResolvedValue('read')
    mocks.selector.mockResolvedValue({ valid: [], invalid: [] })
    mocks.oldCustomTool.mockResolvedValue(null)
    mocks.oldSkill.mockResolvedValue(null)
    mocks.customTools.mockResolvedValue({
      tools: [{ id: 'available', code: 'private implementation' }],
    })
    mocks.skill.mockResolvedValue({ skill: { id: 'available', content: 'private instructions' } })
    mocks.server.mockResolvedValue({
      server: { id: 'available', enabled: true, headers: { secret: 'private token' } },
    })
    mocks.secrets.mockResolvedValue({ secrets: [{ envKey: 'RESOURCE_ID' }] })
  })

  it.each(['custom-tool', 'mcp-tool', 'skill'] as const)(
    'uses the authenticated actor and canonical workspace for %s reads',
    async (kind) => {
      setGraph(kind, ['available'])
      const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
      expect(result.unresolvedReferences).toEqual([])
      expect(lookup(kind)).toHaveBeenCalledWith({
        principal,
        input:
          kind === 'custom-tool'
            ? { workspaceId }
            : kind === 'skill'
              ? { workspaceId, skillId: 'available' }
              : { workspaceId, serverId: 'available' },
        request: undefined,
      })
      expect(mocks.oldCustomTool).not.toHaveBeenCalled()
      expect(mocks.oldSkill).not.toHaveBeenCalled()
      expect(mocks.selector).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('private')
    }
  )

  it.each(['custom-tool', 'mcp-tool', 'skill'] as const)(
    'does not look up secret or output tokens as literal %s IDs',
    async (kind) => {
      setGraph(kind, ['{{RESOURCE_ID}}', '<start.resourceId>', 'prefix-<start.resourceId>'])
      const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
      expect(result.unresolvedReferences.filter((ref) => ref.kind === kind)).toEqual([])
      expect(lookup(kind)).not.toHaveBeenCalled()
      expect(mocks.oldCustomTool).not.toHaveBeenCalled()
      expect(mocks.oldSkill).not.toHaveBeenCalled()
      expect(result.notes).toContain(
        'Agent references in block "Agent" require runtime resolution and were not checked.'
      )
      expect(result.undeclaredEnvVars).toEqual([])
    }
  )

  it.each(['custom-tool', 'mcp-tool', 'skill'] as const)(
    'propagates a %s lookup outage rather than omitting findings',
    async (kind) => {
      setGraph(kind, ['available'])
      lookup(kind).mockRejectedValueOnce(new Error('private database failure'))
      await expect(
        readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
      ).rejects.toThrow('Workflow reference checks could not complete')
    }
  )

  it.each(['not_found', 'forbidden'] as const)(
    'conceals %s details for skill and MCP references',
    async (code) => {
      for (const kind of ['skill', 'mcp-tool'] as const) {
        setGraph(kind, ['missing'])
        lookup(kind).mockRejectedValueOnce(new OrchestrationError(code, 'private resource title'))
        const result = await readWorkflowLint.execute({
          principal,
          input: { workflowId: 'parent' },
        })
        expect(result.unresolvedReferences).toEqual([
          expect.objectContaining({ kind, value: 'missing' }),
        ])
        expect(JSON.stringify(result)).not.toContain('private')
        expect(JSON.stringify(result)).not.toContain('manage_')
      }
    }
  )

  it('reports missing custom tools without obsolete repair commands', async () => {
    setGraph('custom-tool', ['missing'])
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([
      expect.objectContaining({ kind: 'custom-tool', value: 'missing' }),
    ])
    expect(JSON.stringify(result)).not.toContain('manage_')
    expect(result.unresolvedReferences[0]?.reason).toContain('custom-tools list')
  })

  it('uses one authorized custom-tool inventory for every reference', async () => {
    setGraph('custom-tool', ['available', 'missing', 'another-missing'])
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(mocks.customTools).toHaveBeenCalledTimes(1)
    expect(result.unresolvedReferences.map((ref) => ref.value)).toEqual([
      'missing',
      'another-missing',
    ])
  })

  it('preserves inline custom-tool fallback without requiring its missing ID', async () => {
    const graph = setGraph('custom-tool', [])
    mocks.snapshot.mockResolvedValue({
      workflowRecord: scope.workflow,
      normalizedData: {
        ...graph,
        blocks: {
          agent: {
            ...graph.blocks.agent,
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'custom-tool',
                    customToolId: 'missing',
                    schema: {
                      type: 'function',
                      function: { name: 'inline', parameters: {} },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    })
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([])
    expect(mocks.customTools).not.toHaveBeenCalled()
  })

  it('reports a disabled MCP server but never performs live discovery', async () => {
    setGraph('mcp-tool', ['available'])
    mocks.server.mockResolvedValueOnce({ server: { enabled: false } })
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([
      expect.objectContaining({ kind: 'mcp-tool', reason: expect.stringContaining('enabled') }),
    ])
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('does not claim a readable MCP registration proves connectivity or tool availability', async () => {
    setGraph('mcp-tool', ['available'])
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.notes).toContain(
      'MCP checks cover saved server access and enabled state; live connectivity and tool availability were not checked.'
    )
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('does not begin another resource read after cancellation', async () => {
    setGraph('skill', ['available', 'later'])
    const controller = new AbortController()
    mocks.skill.mockImplementationOnce(async () => {
      controller.abort()
      return { skill: { id: 'available' } }
    })
    await expect(
      readWorkflowLint.execute({
        principal,
        input: { workflowId: 'parent', signal: controller.signal },
      })
    ).rejects.toThrow('Workflow reference checks could not complete')
    expect(mocks.skill).toHaveBeenCalledTimes(1)
    expect(mocks.secrets).not.toHaveBeenCalled()
  })
})
