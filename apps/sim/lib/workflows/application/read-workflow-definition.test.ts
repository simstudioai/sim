import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import {
  workflowsQueriesMock,
  workflowsQueriesMockFns,
} from '@sim/testing/mocks/workflows-queries.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/workflows/queries', () => workflowsQueriesMock)

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

import { readWorkflowDefinition } from '@/lib/workflows/application/read-workflow-definition'

const mocks = {
  loadSnapshot: workflowsQueriesMockFns.mockLoadWorkflowReadSnapshot,
}

const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveContext = workflowContextMockFns.mockResolveActiveWorkflowApplicationContext

const WORKFLOW_ID = 'workflow-1'
const WORKSPACE_ID = 'workspace-1'
const principal = createSessionPrincipal()
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
    mockResolveContext.mockResolvedValue(context)
    mockResolvePermission.mockResolvedValue('read')
    mocks.loadSnapshot.mockResolvedValue({
      workflowRecord: snapshotWorkflow,
      normalizedData: draftState,
    })
    workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState.mockResolvedValue({
      ...draftState,
      deploymentVersionId: 'version-1',
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
    workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState.mockResolvedValueOnce(
      deployedState
    )

    const result = await readWorkflowDefinition.execute({
      principal,
      input: { workflowId: WORKFLOW_ID, state: 'deployed' },
    })

    expect(mocks.loadSnapshot).not.toHaveBeenCalled()
    expect(workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState).toHaveBeenCalledWith(
      WORKFLOW_ID,
      WORKSPACE_ID
    )
    expect(result).toEqual({
      workflow: contextWorkflow,
      workspaceId: WORKSPACE_ID,
      state: deployedState,
    })
  })
})
