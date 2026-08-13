/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  loadDraft: vi.fn(),
  getBlock: vi.fn(),
  outputPaths: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadDraft,
}))

vi.mock('@/blocks/registry', () => ({ getBlock: mocks.getBlock }))

vi.mock('@/lib/workflows/blocks/block-outputs', () => ({
  getEffectiveBlockOutputPaths: mocks.outputPaths,
}))

vi.mock('@/lib/workflows/blocks/block-path-calculator', () => ({
  BlockPathCalculator: { findAllPathNodes: vi.fn().mockReturnValue([]) },
}))

vi.mock('@/lib/workflows/blocks/block-reference-tags', () => ({
  getBlockReferenceTags: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/workflows/triggers/run-options', () => ({
  resolveTriggerRunOptions: vi.fn().mockReturnValue([]),
  toPublicRunOption: vi.fn((value) => value),
}))

vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  hasTriggerCapability: vi.fn().mockReturnValue(false),
}))

import { readCopilotWorkflowBlockOutputs } from '@/lib/workflows/application/read-workflow-copilot-metadata'

const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'tool-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-08-01T00:00:00Z'),
  expiresAt: new Date('2999-08-01T00:00:00Z'),
}

describe('Copilot workflow metadata application queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue({
      workflowId: 'workflow-1',
      workflow: {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        variables: {
          variable1: { id: 'variable-1', name: 'Customer Name', type: 'plain' },
        },
      },
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.loadDraft.mockResolvedValue({
      blocks: {
        'agent-1': { type: 'agent', name: 'Support Agent', subBlocks: {} },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    mocks.getBlock.mockReturnValue({ category: 'core' })
    mocks.outputPaths.mockReturnValue(['content'])
  })

  it('owns canonical loading and block output computation', async () => {
    const result = await readCopilotWorkflowBlockOutputs.execute({
      principal,
      input: {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'forged-workspace',
        blockIds: ['agent-1'],
      },
    })

    expect(mocks.resolveContext).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      assertedWorkspaceId: undefined,
    })
    expect(result).toEqual({
      blocks: [
        {
          blockId: 'agent-1',
          blockName: 'Support Agent',
          blockType: 'agent',
          outputs: ['supportagent.content'],
          relativeOutputs: ['content'],
          triggerMode: undefined,
        },
      ],
      variables: [
        {
          id: 'variable-1',
          name: 'Customer Name',
          type: 'plain',
          tag: 'variable.customername',
        },
      ],
    })
  })

  it('rechecks current permission before loading workflow state', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      readCopilotWorkflowBlockOutputs.execute({
        principal,
        input: { workflowId: 'workflow-1', blockIds: ['agent-1'] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadDraft).not.toHaveBeenCalled()
  })

  it('rejects oversized block selections before loading workflow state', async () => {
    await expect(
      readCopilotWorkflowBlockOutputs.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          blockIds: Array.from({ length: 101 }, (_, index) => `block-${index}`),
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.loadDraft).not.toHaveBeenCalled()
  })
})
