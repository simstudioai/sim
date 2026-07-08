/**
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
  posthogServerMock,
  posthogServerMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockArchiveWorkspace } = vi.hoisted(() => ({
  mockArchiveWorkspace: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/workspaces/lifecycle', () => ({
  archiveWorkspace: mockArchiveWorkspace,
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { DELETE } from '@/app/api/workspaces/[id]/route'

function callDelete(workspaceId = 'workspace-1') {
  const request = createMockRequest('DELETE', {})
  return DELETE(request, { params: Promise.resolve({ id: workspaceId }) })
}

describe('DELETE /api/workspaces/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-admin', name: 'Admin', email: 'admin@example.com' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('returns 401 when the caller is unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await callDelete()

    expect(response.status).toBe(401)
    expect(mockArchiveWorkspace).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller lacks admin permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')

    const response = await callDelete()

    expect(response.status).toBe(403)
    expect(mockArchiveWorkspace).not.toHaveBeenCalled()
  })

  it('returns 404 when the workspace does not exist', async () => {
    mockArchiveWorkspace.mockResolvedValue({ archived: false })

    const response = await callDelete()

    expect(response.status).toBe(404)
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('archives the workspace, records an audit entry, and captures the event on success', async () => {
    mockArchiveWorkspace.mockResolvedValue({
      archived: true,
      workspaceName: 'Test Workspace',
    })

    const response = await callDelete('workspace-1')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockArchiveWorkspace).toHaveBeenCalledWith('workspace-1', {
      requestId: 'workspace-workspace-1',
    })
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-admin',
        resourceName: 'Test Workspace',
      })
    )
    expect(posthogServerMockFns.mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-admin',
      'workspace_deleted',
      expect.objectContaining({ workspace_id: 'workspace-1' }),
      expect.objectContaining({ groups: { workspace: 'workspace-1' } })
    )
  })

  it('succeeds and records which members were auto-provisioned a replacement workspace', async () => {
    mockArchiveWorkspace.mockResolvedValue({
      archived: true,
      workspaceName: 'Test Workspace',
      provisionedWorkspaceUserIds: ['user-victim'],
    })

    const response = await callDelete('workspace-1')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          provisionedWorkspaceUserIds: ['user-victim'],
        }),
      })
    )
  })

  it('returns 500 when archival throws unexpectedly', async () => {
    mockArchiveWorkspace.mockRejectedValue(new Error('db exploded'))

    const response = await callDelete()

    expect(response.status).toBe(500)
  })
})
