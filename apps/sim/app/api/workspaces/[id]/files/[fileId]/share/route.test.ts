/**
 * @vitest-environment node
 */
import { auditMock, authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceFile, mockGetShareForResource, mockUpsertFileShare, mockValidateSharing } =
  vi.hoisted(() => ({
    mockGetWorkspaceFile: vi.fn(),
    mockGetShareForResource: vi.fn(),
    mockUpsertFileShare: vi.fn(),
    mockValidateSharing: vi.fn(),
  }))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
}))

vi.mock('@/lib/public-shares/share-manager', () => {
  class ShareValidationError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ShareValidationError'
    }
  }
  return {
    getShareForResource: mockGetShareForResource,
    upsertFileShare: mockUpsertFileShare,
    ShareValidationError,
  }
})

vi.mock('@/ee/access-control/utils/permission-check', () => {
  class PublicFileSharingNotAllowedError extends Error {
    constructor() {
      super('Public file sharing is not allowed based on your permission group settings')
      this.name = 'PublicFileSharingNotAllowedError'
    }
  }
  return { validatePublicFileSharing: mockValidateSharing, PublicFileSharingNotAllowedError }
})

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/audit', () => auditMock)

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const FILE_ID = 'wf_abc'

import { ShareValidationError } from '@/lib/public-shares/share-manager'
import { GET, PUT } from '@/app/api/workspaces/[id]/files/[fileId]/share/route'

const params = (id = WS, fileId = FILE_ID) => ({ params: Promise.resolve({ id, fileId }) })

const putRequest = (body: unknown) =>
  new NextRequest(`http://localhost/api/workspaces/${WS}/files/${FILE_ID}/share`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const getRequest = () =>
  new NextRequest(`http://localhost/api/workspaces/${WS}/files/${FILE_ID}/share`)

const SHARE = {
  id: 'sh_1',
  token: 'tok_1',
  url: 'https://sim.ai/f/tok_1',
  isActive: true,
  resourceType: 'file' as const,
  resourceId: FILE_ID,
}

describe('share route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'User One', email: 'u@example.com' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceFile.mockResolvedValue({ id: FILE_ID, name: 'report.pdf' })
    mockGetShareForResource.mockResolvedValue(SHARE)
    mockUpsertFileShare.mockResolvedValue(SHARE)
    mockValidateSharing.mockResolvedValue(undefined) // policy allows by default
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValueOnce(null)
      const res = await GET(getRequest(), params())
      expect(res.status).toBe(401)
    })

    it('returns 403 when the caller has no workspace access', async () => {
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)
      const res = await GET(getRequest(), params())
      expect(res.status).toBe(403)
    })

    it('returns the share for a member', async () => {
      const res = await GET(getRequest(), params())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ share: SHARE })
    })
  })

  describe('PUT', () => {
    it('returns 403 for a read-only member', async () => {
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')
      const res = await PUT(putRequest({ isActive: true }), params())
      expect(res.status).toBe(403)
      expect(mockUpsertFileShare).not.toHaveBeenCalled()
    })

    it('maps a ShareValidationError to 400, not 500', async () => {
      mockUpsertFileShare.mockRejectedValueOnce(
        new ShareValidationError('Password is required for password-protected shares')
      )
      const res = await PUT(putRequest({ isActive: true, authType: 'password' }), params())
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Password is required for password-protected shares')
    })

    it('returns 404 when the file is not in the workspace', async () => {
      mockGetWorkspaceFile.mockResolvedValueOnce(null)
      const res = await PUT(putRequest({ isActive: true }), params())
      expect(res.status).toBe(404)
      expect(mockUpsertFileShare).not.toHaveBeenCalled()
    })

    it('enables the share for a writer', async () => {
      const res = await PUT(putRequest({ isActive: true }), params())
      expect(res.status).toBe(200)
      expect(mockUpsertFileShare).toHaveBeenCalledWith({
        workspaceId: WS,
        fileId: FILE_ID,
        userId: 'user-1',
        isActive: true,
      })
      expect(await res.json()).toEqual({ share: SHARE })
    })

    it('returns 403 when org access-control disables public sharing (enable)', async () => {
      const { PublicFileSharingNotAllowedError } = await import(
        '@/ee/access-control/utils/permission-check'
      )
      mockValidateSharing.mockRejectedValueOnce(new PublicFileSharingNotAllowedError())
      const res = await PUT(putRequest({ isActive: true }), params())
      expect(res.status).toBe(403)
      expect(mockUpsertFileShare).not.toHaveBeenCalled()
    })

    it('allows disabling a share even when policy disallows enabling', async () => {
      mockValidateSharing.mockRejectedValue(new Error('should not be called for disable'))
      const res = await PUT(putRequest({ isActive: false }), params())
      expect(res.status).toBe(200)
      expect(mockValidateSharing).not.toHaveBeenCalled()
      expect(mockUpsertFileShare).toHaveBeenCalledWith({
        workspaceId: WS,
        fileId: FILE_ID,
        userId: 'user-1',
        isActive: false,
      })
    })

    it('rejects a missing isActive body', async () => {
      const res = await PUT(putRequest({}), params())
      expect(res.status).toBe(400)
    })
  })
})
