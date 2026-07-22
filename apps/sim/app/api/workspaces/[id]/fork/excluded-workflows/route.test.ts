/**
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  createMockRequest,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockAssertWorkspaceAdminAccess, mockCaptureServerEvent } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockAssertWorkspaceAdminAccess: vi.fn(),
    mockCaptureServerEvent: vi.fn(),
  })
)

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  assertWorkspaceAdminAccess: mockAssertWorkspaceAdminAccess,
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

import { PUT } from '@/app/api/workspaces/[id]/fork/excluded-workflows/route'

const WORKSPACE_ID = 'workspace-1'
const ADMIN_ID = 'user-1'
const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID }) }

function mockUpdateReturning(rows: Array<{ id: string; name: string }>) {
  dbChainMockFns.returning.mockResolvedValue(rows)
}

describe('fork excluded-workflows route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: ADMIN_ID } })
    mockAssertWorkspaceAdminAccess.mockResolvedValue({ id: WORKSPACE_ID, name: 'My Workspace' })
    mockUpdateReturning([])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await PUT(
      createMockRequest('PUT', { workflowIds: ['wf-1'], forkSyncExcluded: true }),
      routeContext
    )

    expect(res.status).toBe(401)
    expect(mockAssertWorkspaceAdminAccess).not.toHaveBeenCalled()
  })

  it('rejects an empty workflowIds batch', async () => {
    const res = await PUT(
      createMockRequest('PUT', { workflowIds: [], forkSyncExcluded: true }),
      routeContext
    )

    expect(res.status).toBe(400)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('requires workspace admin (and the fork entitlement gate) before writing', async () => {
    mockUpdateReturning([{ id: 'wf-1', name: 'Alpha' }])

    await PUT(
      createMockRequest('PUT', { workflowIds: ['wf-1'], forkSyncExcluded: true }),
      routeContext
    )

    expect(mockAssertWorkspaceAdminAccess).toHaveBeenCalledWith(WORKSPACE_ID, ADMIN_ID)
  })

  it('updates the batch, reports the transition count, and records one audit entry', async () => {
    mockUpdateReturning([
      { id: 'wf-1', name: 'Alpha' },
      { id: 'wf-2', name: 'Beta' },
    ])

    const res = await PUT(
      createMockRequest('PUT', { workflowIds: ['wf-1', 'wf-2'], forkSyncExcluded: true }),
      routeContext
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 2 })
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        actorId: ADMIN_ID,
        action: 'workflow.fork_sync_excluded',
        resourceId: WORKSPACE_ID,
        metadata: expect.objectContaining({
          forkSyncExcluded: true,
          workflowCount: 2,
          workflowNames: ['Alpha', 'Beta'],
        }),
      })
    )
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      ADMIN_ID,
      'fork_excluded_workflows_updated',
      expect.objectContaining({ workflow_count: 2, fork_sync_excluded: true }),
      { groups: { workspace: WORKSPACE_ID } }
    )
  })

  it('records the inclusion action when unmarking workflows', async () => {
    mockUpdateReturning([{ id: 'wf-1', name: 'Alpha' }])

    const res = await PUT(
      createMockRequest('PUT', { workflowIds: ['wf-1'], forkSyncExcluded: false }),
      routeContext
    )

    expect(res.status).toBe(200)
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow.fork_sync_included' })
    )
  })

  it('skips audit and analytics when nothing transitioned', async () => {
    mockUpdateReturning([])

    const res = await PUT(
      createMockRequest('PUT', { workflowIds: ['wf-unknown'], forkSyncExcluded: true }),
      routeContext
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 0 })
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})
