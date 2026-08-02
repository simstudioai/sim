/**
 * @vitest-environment node
 *
 * Public v2 workflow update/delete: the 404 mask on an access failure (the
 * caller never names a workspace, so a 403 would confirm the workflow exists),
 * the 423 a workflow mutation lock produces, and the orchestration failure
 * codes rendered in the v2 error envelope.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetActiveWorkflowRecord,
  mockPerformUpdateWorkflow,
  mockPerformDeleteWorkflow,
  mockAssertWorkflowMutable,
  mockAssertFolderMutable,
  WorkflowLockedErrorMock,
  FolderLockedErrorMock,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetActiveWorkflowRecord: vi.fn(),
  mockPerformUpdateWorkflow: vi.fn(),
  mockPerformDeleteWorkflow: vi.fn(),
  mockAssertWorkflowMutable: vi.fn(),
  mockAssertFolderMutable: vi.fn(),
  WorkflowLockedErrorMock: class WorkflowLockedError extends Error {
    status = 423
  },
  FolderLockedErrorMock: class FolderLockedError extends Error {
    status = 423
  },
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performUpdateWorkflow: mockPerformUpdateWorkflow,
  performDeleteWorkflow: mockPerformDeleteWorkflow,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  getActiveWorkflowRecord: mockGetActiveWorkflowRecord,
  assertWorkflowMutable: mockAssertWorkflowMutable,
  assertFolderMutable: mockAssertFolderMutable,
  WorkflowLockedError: WorkflowLockedErrorMock,
  FolderLockedError: FolderLockedErrorMock,
}))

vi.mock('@/lib/workflows/input-format', () => ({
  extractInputFieldsFromBlocks: vi.fn().mockReturnValue([]),
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { DELETE, PATCH } from '@/app/api/v2/workflows/[id]/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

const RATE_LIMIT_DENIED = {
  allowed: false,
  limit: 100,
  remaining: 0,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 1000,
}

const ACCESS_DENIED = { status: 403, code: 'FORBIDDEN', message: 'Access denied' }

const WORKFLOW_RECORD = {
  id: 'wf-1',
  name: 'Support Agent',
  description: 'Handles tickets',
  folderId: null,
  workspaceId: 'workspace-1',
  isDeployed: true,
  deployedAt: new Date('2024-01-03T00:00:00Z'),
  runCount: 12,
  lastRunAt: new Date('2024-01-04T00:00:00Z'),
  locked: false,
  forkSyncExcluded: false,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-02T00:00:00Z'),
}

const UPDATED = {
  id: 'wf-1',
  name: 'Support Agent v2',
  description: 'Handles tickets',
  workspaceId: 'workspace-1',
  folderId: null,
  sortOrder: 0,
  locked: false,
  forkSyncExcluded: false,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-05T00:00:00Z'),
  archivedAt: null,
}

const routeContext = () => ({ params: Promise.resolve({ id: 'wf-1' }) })

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/v2/workflows/wf-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    routeContext()
  )
}

const callDelete = () =>
  DELETE(
    new NextRequest('http://localhost:3000/api/v2/workflows/wf-1', { method: 'DELETE' }),
    routeContext()
  )

describe('PATCH /api/v2/workflows/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mockAssertFolderMutable.mockResolvedValue(undefined)
    mockPerformUpdateWorkflow.mockResolvedValue({ success: true, workflow: UPDATED })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPatch({ name: 'Support Agent v2' })

    expect(res.status).toBe(404)
    expect(mockPerformUpdateWorkflow).not.toHaveBeenCalled()
  })

  it('400s when no field to change is supplied', async () => {
    const res = await callPatch({})
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformUpdateWorkflow).not.toHaveBeenCalled()
  })

  it('masks an access-denied failure as 404 so existence is not leaked', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callPatch({ name: 'Support Agent v2' })
    expect(res.status).toBe(404)
    expect(mockPerformUpdateWorkflow).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPatch({ name: 'Support Agent v2' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the workflow does not exist or is archived', async () => {
    mockGetActiveWorkflowRecord.mockResolvedValue(null)
    const res = await callPatch({ name: 'Support Agent v2' })
    expect(res.status).toBe(404)
    expect(mockPerformUpdateWorkflow).not.toHaveBeenCalled()
  })

  it('423s the denial when the workflow is locked rather than failing with a 500', async () => {
    mockAssertWorkflowMutable.mockRejectedValue(new WorkflowLockedErrorMock('Workflow is locked'))
    const res = await callPatch({ name: 'Support Agent v2' })
    expect(res.status).toBe(423)
    expect((await res.json()).error.code).toBe('LOCKED')
    expect(mockPerformUpdateWorkflow).not.toHaveBeenCalled()
  })

  it('423s when the destination folder is locked', async () => {
    mockAssertFolderMutable.mockRejectedValue(new FolderLockedErrorMock('Folder is locked'))
    const res = await callPatch({ folderId: 'fld-1' })
    expect(res.status).toBe(423)
    expect(mockPerformUpdateWorkflow).not.toHaveBeenCalled()
  })

  it('409s when the target name is taken in the destination folder', async () => {
    mockPerformUpdateWorkflow.mockResolvedValue({
      success: false,
      error: 'A workflow named "Support Agent v2" already exists in this folder',
      errorCode: 'conflict',
    })
    const res = await callPatch({ name: 'Support Agent v2' })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })

  it('updates the workflow and carries the untouched deployment counters through', async () => {
    const res = await callPatch({ name: 'Support Agent v2' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      data: {
        id: 'wf-1',
        name: 'Support Agent v2',
        description: 'Handles tickets',
        folderId: null,
        workspaceId: 'workspace-1',
        isDeployed: true,
        deployedAt: '2024-01-03T00:00:00.000Z',
        runCount: 12,
        lastRunAt: '2024-01-04T00:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-05T00:00:00.000Z',
      },
    })
    expect(mockPerformUpdateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        currentName: 'Support Agent',
        currentFolderId: null,
        name: 'Support Agent v2',
      })
    )
  })
})

describe('DELETE /api/v2/workflows/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetActiveWorkflowRecord.mockResolvedValue(WORKFLOW_RECORD)
    mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mockPerformDeleteWorkflow.mockResolvedValue({ success: true })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callDelete()

    expect(res.status).toBe(404)
    expect(mockPerformDeleteWorkflow).not.toHaveBeenCalled()
  })

  it('masks an access-denied failure as 404 so existence is not leaked', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(404)
    expect(mockPerformDeleteWorkflow).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDelete()
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('404s when the workflow does not exist or is already archived', async () => {
    mockGetActiveWorkflowRecord.mockResolvedValue(null)
    const res = await callDelete()
    expect(res.status).toBe(404)
    expect(mockPerformDeleteWorkflow).not.toHaveBeenCalled()
  })

  it('423s the denial when the workflow is locked rather than failing with a 500', async () => {
    mockAssertWorkflowMutable.mockRejectedValue(new WorkflowLockedErrorMock('Workflow is locked'))
    const res = await callDelete()
    expect(res.status).toBe(423)
    expect((await res.json()).error.code).toBe('LOCKED')
    expect(mockPerformDeleteWorkflow).not.toHaveBeenCalled()
  })

  it('400s when it is the last workflow in the workspace', async () => {
    mockPerformDeleteWorkflow.mockResolvedValue({
      success: false,
      error: 'Cannot delete the only workflow in the workspace',
      errorCode: 'validation',
    })
    const res = await callDelete()
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('only workflow')
  })

  it('archives the workflow and acknowledges the delete', async () => {
    const res = await callDelete()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { id: 'wf-1', deleted: true } })
    expect(mockPerformDeleteWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-1', userId: 'user-1' })
    )
  })
})
