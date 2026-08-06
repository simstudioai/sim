/**
 * @vitest-environment node
 */
import { authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpdateWorkspaceFileDimensions } = vi.hoisted(() => ({
  mockUpdateWorkspaceFileDimensions: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  updateWorkspaceFileDimensions: mockUpdateWorkspaceFileDimensions,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const FILE = 'wf_abc123'
const KEY = 'workspace/7727ef3f/screenshot.png'

import { PATCH } from '@/app/api/workspaces/[id]/files/[fileId]/dimensions/route'

const routeContext = { params: Promise.resolve({ id: WS, fileId: FILE }) }

function buildRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/workspaces/${WS}/files/${FILE}/dimensions`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/workspaces/[id]/files/[fileId]/dimensions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockUpdateWorkspaceFileDimensions.mockResolvedValue(true)
  })

  it('stores dimensions for a writer, keyed to the content version', async () => {
    const res = await PATCH(buildRequest({ key: KEY, width: 1600, height: 900 }), routeContext)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(mockUpdateWorkspaceFileDimensions).toHaveBeenCalledWith(WS, FILE, {
      key: KEY,
      width: 1600,
      height: 900,
    })
  })

  it('allows an admin', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
    const res = await PATCH(buildRequest({ key: KEY, width: 10, height: 20 }), routeContext)
    expect(res.status).toBe(200)
    expect(mockUpdateWorkspaceFileDimensions).toHaveBeenCalledOnce()
  })

  it('reports success:false when the content-version guard rejects the write (key changed)', async () => {
    mockUpdateWorkspaceFileDimensions.mockResolvedValue(false)
    const res = await PATCH(buildRequest({ key: KEY, width: 10, height: 20 }), routeContext)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: false })
  })

  it('rejects an unauthenticated caller before touching the DB', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const res = await PATCH(buildRequest({ key: KEY, width: 10, height: 10 }), routeContext)
    expect(res.status).toBe(401)
    expect(mockUpdateWorkspaceFileDimensions).not.toHaveBeenCalled()
  })

  it('rejects a read-only member (backfill requires write)', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    const res = await PATCH(buildRequest({ key: KEY, width: 10, height: 10 }), routeContext)
    expect(res.status).toBe(403)
    expect(mockUpdateWorkspaceFileDimensions).not.toHaveBeenCalled()
  })

  it('rejects a missing key or non-positive / non-integer dimensions', async () => {
    for (const body of [
      { width: 10, height: 10 }, // missing key
      { key: KEY, width: 0, height: 10 },
      { key: KEY, width: 10, height: -5 },
      { key: KEY, width: 10.5, height: 10 },
      { key: KEY, width: 10 },
    ]) {
      const res = await PATCH(buildRequest(body), routeContext)
      expect(res.status).toBe(400)
    }
    expect(mockUpdateWorkspaceFileDimensions).not.toHaveBeenCalled()
  })
})
