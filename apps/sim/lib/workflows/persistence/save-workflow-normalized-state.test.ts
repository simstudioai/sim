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
  getUserPermissionConfig: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
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

import { OrchestrationError } from '@/lib/core/orchestration/types'
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
    mocks.getUserPermissionConfig.mockResolvedValue(null)
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
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('stores a state whose block types the allowlist names', async () => {
    mocks.getUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['starter'] })

    await expect(saveWorkflowNormalizedState(params())).resolves.toMatchObject({ success: true })
  })

  /** A workflow with no workspace has no permission group to resolve. */
  it('skips the block-type check for a workflow outside any workspace', async () => {
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-1', workspaceId: null },
      workspacePermission: 'write',
    })

    await expect(saveWorkflowNormalizedState(params())).resolves.toMatchObject({ success: true })
    expect(mocks.getUserPermissionConfig).not.toHaveBeenCalled()
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
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('reports a workflow archived since the authorization check as 404', async () => {
    mocks.replace.mockRejectedValue(new OrchestrationError('not_found', 'Workflow not found'))

    await expect(saveWorkflowNormalizedState(params())).resolves.toEqual({
      success: false,
      status: 404,
      error: 'Workflow not found',
    })
    expect(mocks.notify).not.toHaveBeenCalled()
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
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
