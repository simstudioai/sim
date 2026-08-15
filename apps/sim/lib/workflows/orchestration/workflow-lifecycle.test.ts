/**
 * @vitest-environment node
 */
import {
  auditMock,
  dbChainMockFns,
  posthogServerMock,
  resetDbChainMock,
  workflowAuthzMockFns,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)
vi.mock('@/lib/workflows/lifecycle', () => ({
  archiveWorkflow: vi.fn(),
  restoreWorkflow: vi.fn(),
}))
vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: () => ({
    workflowState: { blocks: {}, edges: [], loops: {}, parallels: {} },
    subBlockValues: {},
    startBlockId: 'start-1',
  }),
}))

import { performCreateWorkflowTransition } from '@/lib/workflows/orchestration/workflow-lifecycle'

/** Shape the `postgres` driver throws for a unique violation. */
const uniqueViolation = (constraintName: string) =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraintName,
  })

const createParams = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  name: 'My Workflow',
}

describe('performCreateWorkflowTransition unique-violation handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    workflowAuthzMockFns.mockIsFolderInWorkspace.mockResolvedValue(true)
    workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables.mockResolvedValue({
      success: true,
    })
  })

  it('reports a lost name race as a conflict', async () => {
    dbChainMockFns.transaction.mockRejectedValueOnce(
      uniqueViolation('workflow_workspace_folder_name_active_unique')
    )

    const result = await performCreateWorkflowTransition(createParams)

    expect(result).toEqual({
      success: false,
      error: 'A workflow named "My Workflow" already exists in this folder',
      errorCode: 'conflict',
    })
  })

  it('does not report a block-id collision as a name conflict', async () => {
    /**
     * `workflow_blocks.id` is a global primary key and the same transaction runs
     * `saveWorkflowToNormalizedTables`, so a colliding block id raises `23505`
     * from a constraint that has nothing to do with the workflow name. Relabelling
     * it hides an integrity fault behind a message about a duplicate name.
     */
    const collision = uniqueViolation('workflow_blocks_pkey')
    dbChainMockFns.transaction.mockRejectedValueOnce(collision)

    await expect(performCreateWorkflowTransition(createParams)).rejects.toBe(collision)
  })

  it('propagates a unique violation that carries no constraint name', async () => {
    const opaque = Object.assign(new Error('duplicate key value'), { code: '23505' })
    dbChainMockFns.transaction.mockRejectedValueOnce(opaque)

    await expect(performCreateWorkflowTransition(createParams)).rejects.toBe(opaque)
  })
})
