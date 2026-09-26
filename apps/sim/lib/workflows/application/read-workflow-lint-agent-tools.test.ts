import type { OAuthAccessTokenPrincipal } from '@sim/auth/principal'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { toolsUtilsMock } from '@sim/testing/mocks/blocks.mock'
import { mcpUseCasesMock, mcpUseCasesMockFns } from '@sim/testing/mocks/mcp-use-cases.mock'
import {
  secretsUseCasesMock,
  secretsUseCasesMockFns,
} from '@sim/testing/mocks/secrets-use-cases.mock'
import { tableServiceMock } from '@sim/testing/mocks/table-service.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsQueriesMock,
  workflowsQueriesMockFns,
} from '@sim/testing/mocks/workflows-queries.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'

const hoisted = vi.hoisted(() => ({
  selector: vi.fn(),
  customTools: vi.fn(),
  skill: vi.fn(),
  oldCustomTool: vi.fn(),
  oldSkill: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/queries', () => workflowsQueriesMock)
vi.mock('@/lib/workflows/editing/selector-validator', () => ({
  validateSelectorIds: hoisted.selector,
}))
vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  getCustomToolById: hoisted.oldCustomTool,
}))
vi.mock('@/lib/workflows/skills/operations', () => ({ getSkillById: hoisted.oldSkill }))
vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  listAvailableCustomToolsUseCase: { execute: hoisted.customTools },
}))
vi.mock('@/lib/skills/application/use-cases', () => ({
  getSkillUseCase: { execute: hoisted.skill },
}))
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)
vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/secrets/application/use-cases', () => secretsUseCasesMock)
vi.mock('@/blocks/utils', () => ({ getModelOptions: vi.fn(() => []) }))
vi.mock('@/tools/utils', () => toolsUtilsMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readWorkflowLint } from '@/lib/workflows/application/read-workflow-lint'
import { UNRESOLVABLE_AT_LINT_NOTE } from '@/lib/workflows/editing/validation'

const mocks = {
  ...hoisted,
  snapshot: workflowsQueriesMockFns.mockLoadWorkflowReadSnapshot,
  server: mcpUseCasesMockFns.mockGetMcpServerUseCase,
  discover: mcpUseCasesMockFns.mockDiscoverMcpServerToolsUseCase,
  secrets: secretsUseCasesMockFns.mockListSecretsUseCase,
}

const mockGetBlock = getBlock as Mock
mockGetBlock.mockImplementation((type: string) => ({
  type,
  name: type,
  outputs: {},
  subBlocks: [],
}))

const mockPermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockContext = workflowContextMockFns.mockResolveActiveWorkflowApplicationContext

const principal = createPersonalApiKeyPrincipal()
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
    mockContext.mockResolvedValue(scope)
    mockPermission.mockResolvedValue('read')
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

  it('carries a scoped OAuth actor through the same diagnostics and secret read boundary', async () => {
    setGraph('skill', ['available', '{{RESOURCE_ID}}'])
    const token: OAuthAccessTokenPrincipal = {
      kind: 'oauth_access_token',
      userId: 'user-1',
      clientId: 'client-1',
      tokenId: 'token-1',
      scopes: ['api:read'],
      expiresAt: new Date('2099-01-01'),
    }
    await readWorkflowLint.execute({ principal: token, input: { workflowId: 'parent' } })
    expect(mocks.skill).toHaveBeenCalledWith(expect.objectContaining({ principal: token }))
    expect(mocks.secrets).toHaveBeenCalledWith(expect.objectContaining({ principal: token }))
  })

  it.each(['scope', 'expiry'] as const)(
    'denies OAuth diagnostics with invalid %s before protected reads',
    async (invalid) => {
      setGraph('skill', ['available'])
      const token: OAuthAccessTokenPrincipal = {
        kind: 'oauth_access_token',
        userId: 'user-1',
        clientId: 'client-1',
        tokenId: 'token-1',
        scopes: invalid === 'scope' ? [] : ['api:read'],
        expiresAt: new Date(invalid === 'expiry' ? '2000-01-01' : '2099-01-01'),
      }
      await expect(
        readWorkflowLint.execute({ principal: token, input: { workflowId: 'parent' } })
      ).rejects.toThrow()
      expect(mocks.snapshot).not.toHaveBeenCalled()
      expect(mocks.secrets).not.toHaveBeenCalled()
      expect(mocks.skill).not.toHaveBeenCalled()
    }
  )

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
        kind === 'mcp-tool'
          ? UNRESOLVABLE_AT_LINT_NOTE
          : 'Agent references in block "Agent" require runtime resolution and were not checked.'
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
