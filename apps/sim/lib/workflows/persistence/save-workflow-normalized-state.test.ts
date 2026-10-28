/**
 * Characterization of the legacy internal door's wire behavior. It now delegates
 * the write to `replaceWorkflowNormalizedState`, so these assertions are what
 * proves the extraction did not move a status or a message.
 */
import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { workflowAuthzMockFns } from '@sim/testing'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/workflows/persistence/replace-normalized-state', async () => {
  class WorkflowStatePersistenceError extends Error {
    constructor(readonly detail: string) {
      super('Failed to save workflow state')
      this.name = 'WorkflowStatePersistenceError'
    }
  }
  return {
    WorkflowStatePersistenceError,
    replaceWorkflowNormalizedState: mocks.replace,
  }
})
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { WorkflowStatePersistenceError } from '@/lib/workflows/persistence/replace-normalized-state'
import { saveWorkflowNormalizedState } from '@/lib/workflows/persistence/save-normalized-state'

const mockGetUserPermissionConfig = permissionGroupsResolveMockFns.mockGetUserPermissionConfig
const mockNotify = realtimeNotifyMockFns.mockNotifyWorkflowUpdated

const STATE = {
  blocks: {
    'block-1': {
      id: 'block-1',
      type: 'starter',
      name: 'Start',
      position: { x: 0, y: 0 },
      subBlocks: {},
      outputs: {},
      enabled: true,
    },
  },
  edges: [],
} as never

function params(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'request-1',
    workflowId: 'workflow-1',
    userId: 'user-1',
    state: STATE,
    ...overrides,
  } as Parameters<typeof saveWorkflowNormalizedState>[0]
}

describe('saveWorkflowNormalizedState', () => {
  beforeEach(() => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
      workspacePermission: 'write',
    })
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mocks.replace.mockResolvedValue({ warnings: ['dropped an edge'], state: STATE })
    mockGetUserPermissionConfig.mockResolvedValue(null)
  })

  /**
   * The bypass this closes: a graph replace never went through the editing
   * operations, so a member whose group withholds an integration could still
   * store a block using it and have it refused only at run time, if ever.
   *
   * The check itself now lives on the shared write, so what this door owes is
   * naming the right subject and rendering the primitive's `forbidden` refusal
   * as the 403 it used to build inline.
   */
  it('names the authorizing user as the subject the permission group governs', async () => {
    await saveWorkflowNormalizedState(params())

    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: 'user-1', workspaceId: 'workspace-1' })
    )
  })

  it('refuses a state carrying a block type the permission group withholds', async () => {
    mocks.replace.mockRejectedValue(
      new OrchestrationError(
        'forbidden',
        'Block type "gmail" is not allowed by your organization\'s permission group'
      )
    )

    const result = await saveWorkflowNormalizedState(params())

    expect(result).toMatchObject({ success: false, status: 403 })
    expect(result.success === false && result.error).toContain('gmail')
    expect(mockNotify).not.toHaveBeenCalled()
  })

  /** A workflow with no workspace has no permission group to resolve. */
  it('reports a missing workflow as 404 without writing', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      status: 404,
      workflow: null,
    })

    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: false,
      status: 404,
      error: 'Workflow not found',
    })
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('reports a locked workflow as 423 without writing', async () => {
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValue(
      new WorkflowLockedError('Workflow is locked')
    )

    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: false,
      status: 423,
      error: 'Workflow is locked',
    })
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('reports a persistence failure as 500 with its detail and does not notify', async () => {
    mocks.replace.mockRejectedValue(new WorkflowStatePersistenceError('constraint violation'))

    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: false,
      status: 500,
      error: 'Failed to save workflow state',
      details: 'constraint violation',
    })
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('reports a claimed graph id as 409 carrying the ids to change', async () => {
    mocks.replace.mockRejectedValue(
      new OrchestrationError(
        'conflict',
        'Block ids already used by another workflow: block-1, block-2'
      )
    )

    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: false,
      status: 409,
      error: 'Block ids already used by another workflow: block-1, block-2',
    })
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('reports a workflow archived since the authorization check as 404', async () => {
    mocks.replace.mockRejectedValue(new OrchestrationError('not_found', 'Workflow not found'))

    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: false,
      status: 404,
      error: 'Workflow not found',
    })
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('classifies through the wrapper drizzle puts around a throw inside the transaction', async () => {
    const wrapped = new Error('insert into "workflow_blocks" ...', {
      cause: new OrchestrationError(
        'conflict',
        'Edge ids already used by another workflow: edge-1'
      ),
    })
    mocks.replace.mockRejectedValue(wrapped)

    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: false,
      status: 409,
      error: 'Edge ids already used by another workflow: edge-1',
    })
  })

  it('hides the text of an unclassified orchestration failure behind the generic wording', async () => {
    mocks.replace.mockRejectedValue(
      new OrchestrationError('internal', 'insert into "workflow_blocks" values ($1, $2)')
    )

    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: false,
      status: 500,
      error: 'Failed to save workflow state',
    })
  })

  it('propagates an unclassified fault rather than turning it into a status', async () => {
    mocks.replace.mockRejectedValue(new Error('pool exhausted'))

    await expect(saveWorkflowNormalizedState(params())).rejects.toThrow('pool exhausted')
    expect(mockNotify).not.toHaveBeenCalled()
  })
})
