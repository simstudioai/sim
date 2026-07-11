/**
 * @vitest-environment node
 *
 * Thin route-level smoke test: confirms `POST /api/workspaces/[id]/files/move`
 * maps an orchestration `errorCode: 'locked'` (a folder or file lock hit
 * inside `performMoveWorkspaceFileItems`) to a 423 response, rather than
 * exercising the lock logic itself — that's covered at the orchestration
 * layer in `lib/workspace-files/orchestration/file-folder-lifecycle.test.ts`.
 */
import { authMockFns, permissionsMock, permissionsMockFns, posthogServerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPerformMoveWorkspaceFileItems } = vi.hoisted(() => ({
  mockPerformMoveWorkspaceFileItems: vi.fn(),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performMoveWorkspaceFileItems: mockPerformMoveWorkspaceFileItems,
  workspaceFilesOrchestrationStatus: (
    errorCode: 'validation' | 'not_found' | 'conflict' | 'locked' | 'internal' | undefined
  ) => {
    if (errorCode === 'validation') return 400
    if (errorCode === 'conflict') return 409
    if (errorCode === 'not_found') return 404
    if (errorCode === 'locked') return 423
    return 500
  },
}))

vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'

import { POST } from '@/app/api/workspaces/[id]/files/move/route'

const params = (id = WS) => ({ params: Promise.resolve({ id }) })

const makeRequest = (body: unknown) =>
  new NextRequest(`http://localhost/api/workspaces/${WS}/files/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('move route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'User One', email: 'u@example.com' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  it('returns 401 when unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const res = await POST(
      makeRequest({ fileIds: ['file-1'], targetFolderId: 'folder-2' }),
      params()
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a caller without write access', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')
    const res = await POST(
      makeRequest({ fileIds: ['file-1'], targetFolderId: 'folder-2' }),
      params()
    )
    expect(res.status).toBe(403)
    expect(mockPerformMoveWorkspaceFileItems).not.toHaveBeenCalled()
  })

  it('returns 423 when the orchestration layer reports a lock (folder or file)', async () => {
    mockPerformMoveWorkspaceFileItems.mockResolvedValueOnce({
      success: false,
      error: 'Folder is locked',
      errorCode: 'locked',
    })

    const res = await POST(
      makeRequest({ folderIds: ['folder-1'], targetFolderId: 'folder-2' }),
      params()
    )

    expect(res.status).toBe(423)
    expect(await res.json()).toEqual({ success: false, error: 'Folder is locked' })
  })

  it('moves successfully when nothing is locked', async () => {
    mockPerformMoveWorkspaceFileItems.mockResolvedValueOnce({
      success: true,
      movedItems: { files: 1, folders: 0 },
    })

    const res = await POST(
      makeRequest({ fileIds: ['file-1'], targetFolderId: 'folder-2' }),
      params()
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, movedItems: { files: 1, folders: 0 } })
  })
})
