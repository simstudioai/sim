/**
 * @vitest-environment node
 *
 * Characterization of the legacy internal door's wire behavior. It now delegates
 * the write to `replaceWorkflowNormalizedState`, so these assertions are what
 * proves the extraction did not move a status or a message.
 */
import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  notify: vi.fn(),
}))

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
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkflowUpdated: mocks.notify }))

import { WorkflowStatePersistenceError } from '@/lib/workflows/persistence/replace-normalized-state'
import { saveWorkflowNormalizedState } from '@/lib/workflows/persistence/save-normalized-state'

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
    vi.clearAllMocks()
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
      workspacePermission: 'write',
    })
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mocks.replace.mockResolvedValue({ warnings: ['dropped an edge'], state: STATE })
  })

  it('returns success with the preparation warnings and notifies once', async () => {
    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: true,
      warnings: ['dropped an edge'],
    })

    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        attributedUserId: 'user-1',
      })
    )
    expect(mocks.notify).toHaveBeenCalledWith('workflow-1')
  })

  it('reuses an authorization decision the caller already resolved', async () => {
    await saveWorkflowNormalizedState(
      params({
        authorization: {
          allowed: true,
          status: 200,
          workflow: { id: 'workflow-1', workspaceId: 'workspace-2' },
          workspacePermission: 'admin',
        },
      })
    )

    expect(workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-2' })
    )
  })

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

  it('passes the authorization status and message straight through on a denial', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      status: 403,
      message: 'Access denied',
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })

    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: false,
      status: 403,
      error: 'Access denied',
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
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('propagates an unclassified fault rather than turning it into a status', async () => {
    mocks.replace.mockRejectedValue(new Error('pool exhausted'))

    await expect(saveWorkflowNormalizedState(params())).rejects.toThrow('pool exhausted')
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
