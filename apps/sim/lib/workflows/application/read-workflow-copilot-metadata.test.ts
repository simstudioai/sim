import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'

const mocks = vi.hoisted(() => ({
  outputPaths: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

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

const mockGetBlock = getBlock as Mock
mockGetBlock.mockReturnValue(undefined)

const mockLoadDraft = workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables

const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveContext = workflowContextMockFns.mockResolveActiveWorkflowApplicationContext

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
    mockResolveContext.mockResolvedValue({
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
    mockResolvePermission.mockResolvedValue('read')
    mockLoadDraft.mockResolvedValue({
      blocks: {
        'agent-1': { type: 'agent', name: 'Support Agent', subBlocks: {} },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    mockGetBlock.mockReturnValue({ category: 'core' })
    mocks.outputPaths.mockReturnValue(['content'])
  })

  it('rechecks current permission before loading workflow state', async () => {
    mockResolvePermission.mockResolvedValue(null)

    await expect(
      readCopilotWorkflowBlockOutputs.execute({
        principal,
        input: { workflowId: 'workflow-1', blockIds: ['agent-1'] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mockLoadDraft).not.toHaveBeenCalled()
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

    expect(mockLoadDraft).not.toHaveBeenCalled()
  })
})
