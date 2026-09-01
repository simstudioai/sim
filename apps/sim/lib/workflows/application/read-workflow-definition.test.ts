/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadDeployed: vi.fn(),
  loadSnapshot: vi.fn(),
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

vi.mock('@/lib/workflows/queries', () => ({
  loadWorkflowReadSnapshot: mocks.loadSnapshot,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mocks.loadDeployed,
  NoActiveDeploymentError: class NoActiveDeploymentError extends Error {},
}))

import { readWorkflowDefinition } from '@/lib/workflows/application/read-workflow-definition'

const WORKFLOW_ID = 'workflow-1'
const WORKSPACE_ID = 'workspace-1'
const principal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}
const contextWorkflow = {
  id: WORKFLOW_ID,
  workspaceId: WORKSPACE_ID,
  archivedAt: null,
  name: 'Context workflow',
}
const snapshotWorkflow = {
  ...contextWorkflow,
  name: 'Snapshot workflow',
}
const context = {
  workflowId: WORKFLOW_ID,
  workflow: contextWorkflow,
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const draftState = {
  blocks: {},
  edges: [],
  loops: {},
  parallels: {},
  isFromNormalizedTables: true,
}

describe('readWorkflowDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.loadSnapshot.mockResolvedValue({
      workflowRecord: snapshotWorkflow,
      normalizedData: draftState,
    })
    mocks.loadDeployed.mockResolvedValue({ ...draftState, deploymentVersionId: 'version-1' })
  })

  it('returns the workflow row and draft state from one canonical snapshot', async () => {
    const result = await readWorkflowDefinition.execute({
      principal,
      input: { workflowId: WORKFLOW_ID, state: 'draft' },
    })

    expect(mocks.loadSnapshot).toHaveBeenCalledWith(WORKFLOW_ID, WORKSPACE_ID)
    expect(mocks.loadDeployed).not.toHaveBeenCalled()
    expect(result).toEqual({
      workflow: snapshotWorkflow,
      workspaceId: WORKSPACE_ID,
      state: draftState,
    })
  })

  it.each([
    ['missing', null],
    ['archived', { ...snapshotWorkflow, archivedAt: new Date('2026-08-11T00:00:00Z') }],
    ['cross-workspace', { ...snapshotWorkflow, workspaceId: 'workspace-other' }],
  ])('rejects a %s workflow row returned by the draft snapshot', async (_label, workflowRecord) => {
    mocks.loadSnapshot.mockResolvedValueOnce({ workflowRecord, normalizedData: draftState })

    await expect(
      readWorkflowDefinition.execute({
        principal,
        input: { workflowId: WORKFLOW_ID, state: 'draft' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('keeps deployed reads on the immutable deployment-state path', async () => {
    const deployedState = { ...draftState, deploymentVersionId: 'version-1' }
    mocks.loadDeployed.mockResolvedValueOnce(deployedState)

    const result = await readWorkflowDefinition.execute({
      principal,
      input: { workflowId: WORKFLOW_ID, state: 'deployed' },
    })

    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
    expect(mocks.loadDeployed).toHaveBeenCalledWith(WORKFLOW_ID, WORKSPACE_ID)
    expect(result).toEqual({
      workflow: contextWorkflow,
      workspaceId: WORKSPACE_ID,
      state: deployedState,
    })
  })
})
