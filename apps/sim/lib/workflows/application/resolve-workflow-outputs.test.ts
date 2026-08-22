/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  flatten: vi.fn(),
  load: vi.fn(),
  order: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
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

vi.mock('@/lib/workflows/blocks/flatten-outputs', () => ({
  flattenWorkflowOutputs: mocks.flatten,
  getBlockExecutionOrder: mocks.order,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.load,
}))

import { resolveWorkflowOutputs } from '@/lib/workflows/application/resolve-workflow-outputs'

const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-08-01T00:00:00.000Z'),
  expiresAt: new Date('2099-08-01T00:00:00.000Z'),
}

describe('resolveWorkflowOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveContext.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
      workflow: { id: 'workflow-1' },
    })
    mocks.load.mockResolvedValue({
      blocks: { block1: { id: 'block-1', type: 'agent', name: 'Agent', subBlocks: {} } },
      edges: [],
    })
    mocks.flatten.mockReturnValue([
      {
        blockId: 'block-1',
        blockName: 'Agent',
        blockType: 'agent',
        path: 'content',
        leafType: 'string',
      },
    ])
    mocks.order.mockReturnValue({ 'block-1': 1 })
  })

  it('binds the canonical workflow load to the trusted Copilot workspace', async () => {
    await expect(
      resolveWorkflowOutputs.execute({
        principal,
        input: { workflowId: 'workflow-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).resolves.toMatchObject({
      workflowId: 'workflow-1',
      outputs: [{ blockId: 'block-1', path: 'content' }],
      executionOrderByBlockId: { 'block-1': 1 },
    })

    expect(mocks.resolveContext).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.load).toHaveBeenCalledWith('workflow-1')
  })

  it('conceals cross-workspace workflow ids before loading workflow state', async () => {
    mocks.resolveContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Workflow not found')
    )

    await expect(
      resolveWorkflowOutputs.execute({
        principal,
        input: { workflowId: 'workflow-other', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workflow not found' })
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('rejects expired delegated scope before loading workflow state', async () => {
    await expect(
      resolveWorkflowOutputs.execute({
        principal: { ...principal, expiresAt: new Date(0) },
        input: { workflowId: 'workflow-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
