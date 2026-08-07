/**
 * @vitest-environment node
 */
import { authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPerformRenameWorkspaceFile, mockPerformDeleteWorkspaceFileItems } = vi.hoisted(() => ({
  mockPerformRenameWorkspaceFile: vi.fn(),
  mockPerformDeleteWorkspaceFileItems: vi.fn(),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performDeleteWorkspaceFileItems: mockPerformDeleteWorkspaceFileItems,
  performRenameWorkspaceFile: mockPerformRenameWorkspaceFile,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const FILE_ID = 'ec28e5d5-898a-48f0-aa6f-2fd7427c9563'

import { captureServerEvent } from '@/lib/posthog/server'
import { PATCH } from '@/app/api/workspaces/[id]/files/[fileId]/route'

const params = () => ({ params: Promise.resolve({ id: WS, fileId: FILE_ID }) })

const patchRequest = (body: unknown) =>
  new NextRequest(`http://localhost/api/workspaces/${WS}/files/${FILE_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const RENAMED_FILE = {
  id: FILE_ID,
  workspaceId: WS,
  name: 'untitled.json',
  key: `workspace/${WS}/mock-key`,
  path: '/api/files/serve/mock-key?context=workspace',
  size: 0,
  type: 'application/json',
  uploadedBy: 'user-1',
  folderId: null,
  uploadedAt: new Date('2026-04-13T00:00:00.000Z'),
  updatedAt: new Date('2026-04-13T00:00:00.000Z'),
}

describe('PATCH /api/workspaces/[id]/files/[fileId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'User One', email: 'u@example.com' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockPerformRenameWorkspaceFile.mockResolvedValue({ success: true, file: RENAMED_FILE })
  })

  describe('auth', () => {
    it('returns 401 when unauthenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValueOnce(null)
      const res = await PATCH(patchRequest({ name: 'notes.md' }), params())
      expect(res.status).toBe(401)
    })

    it('returns 403 for a read-only member', async () => {
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')
      const res = await PATCH(patchRequest({ name: 'notes.md' }), params())
      expect(res.status).toBe(403)
      expect(mockPerformRenameWorkspaceFile).not.toHaveBeenCalled()
    })
  })

  describe('rename only', () => {
    it('forwards the name with no contentType', async () => {
      const res = await PATCH(patchRequest({ name: 'notes.md' }), params())

      expect(res.status).toBe(200)
      expect(mockPerformRenameWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'notes.md', contentType: undefined })
      )
      expect(captureServerEvent).toHaveBeenCalledWith(
        'user-1',
        'file_renamed',
        expect.anything(),
        expect.anything()
      )
    })

    it('returns 409 on a name conflict', async () => {
      mockPerformRenameWorkspaceFile.mockResolvedValueOnce({
        success: false,
        error: 'A file named "notes.md" already exists',
        errorCode: 'conflict',
      })
      const res = await PATCH(patchRequest({ name: 'notes.md' }), params())
      expect(res.status).toBe(409)
    })
  })

  describe('retype', () => {
    it('forwards a valid name and contentType pair', async () => {
      const res = await PATCH(
        patchRequest({ name: 'untitled.json', contentType: 'application/json' }),
        params()
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({
        success: true,
        file: expect.objectContaining({ name: 'untitled.json', type: 'application/json' }),
      })
      expect(mockPerformRenameWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'untitled.json', contentType: 'application/json' })
      )
    })

    it('reports a retype separately from a rename', async () => {
      await PATCH(
        patchRequest({ name: 'untitled.json', contentType: 'application/json' }),
        params()
      )

      expect(captureServerEvent).toHaveBeenCalledWith(
        'user-1',
        'file_type_changed',
        expect.objectContaining({ content_type: 'application/json' }),
        expect.anything()
      )
    })

    it('rejects a contentType outside the selectable allowlist', async () => {
      const res = await PATCH(
        patchRequest({ name: 'installer.exe', contentType: 'application/x-msdownload' }),
        params()
      )

      expect(res.status).toBe(400)
      expect(mockPerformRenameWorkspaceFile).not.toHaveBeenCalled()
    })

    it('rejects a contentType that disagrees with the name extension', async () => {
      const res = await PATCH(
        patchRequest({ name: 'untitled.json', contentType: 'text/markdown' }),
        params()
      )

      expect(res.status).toBe(400)
      expect(mockPerformRenameWorkspaceFile).not.toHaveBeenCalled()
    })

    it('rejects a contentType paired with an extension no type writes', async () => {
      const res = await PATCH(
        patchRequest({ name: 'notes.yml', contentType: 'application/x-yaml' }),
        params()
      )

      expect(res.status).toBe(400)
      expect(mockPerformRenameWorkspaceFile).not.toHaveBeenCalled()
    })
  })
})
