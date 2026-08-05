/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetUserEntityPermissions,
  mockGetWorkspaceShares,
  mockListWorkspaceFiles,
  mockPerformCreateWorkspaceFile,
} = vi.hoisted(() => ({
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceShares: vi.fn(),
  mockListWorkspaceFiles: vi.fn(),
  mockPerformCreateWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  getWorkspaceShares: mockGetWorkspaceShares,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  listWorkspaceFiles: mockListWorkspaceFiles,
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES: 70 * 1024 * 1024,
  performCreateWorkspaceFile: mockPerformCreateWorkspaceFile,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))
vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: vi.fn().mockResolvedValue('write'),
}))

import { POST } from '@/app/api/workspaces/[id]/files/route'

const WORKSPACE_ID = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const USER = { id: 'user-1', name: 'Test User', email: 'test@sim.ai' }
const CREATED_FILE = {
  id: 'wf_created',
  workspaceId: WORKSPACE_ID,
  name: 'untitled.md',
  key: `workspace/${WORKSPACE_ID}/untitled.md`,
  path: '/api/files/serve/untitled.md?context=workspace',
  size: 0,
  type: 'text/markdown',
  uploadedBy: USER.id,
  folderId: null,
  folderPath: null,
  deletedAt: null,
  uploadedAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
}

const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID }) }

function createRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/workspaces/[id]/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: USER })
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetWorkspaceShares.mockResolvedValue(new Map())
    mockListWorkspaceFiles.mockResolvedValue([])
    mockPerformCreateWorkspaceFile.mockResolvedValue({ success: true, file: CREATED_FILE })
  })

  it('authenticates before parsing an invalid request body', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest('{not-json'), routeContext)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })

  it('authorizes the workspace before parsing the request body', async () => {
    mockGetUserEntityPermissions.mockResolvedValue('read')

    const response = await POST(createRequest({ content: 'missing a name' }), routeContext)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(USER.id, 'workspace', WORKSPACE_ID)
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })

  it('rejects an invalid body after workspace authorization', async () => {
    const response = await POST(createRequest({ content: 'missing a name' }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Validation error')
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(USER.id, 'workspace', WORKSPACE_ID)
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })

  it.each(['read', null])(
    'requires write or admin permission (%s is rejected)',
    async (permission) => {
      mockGetUserEntityPermissions.mockResolvedValue(permission)

      const response = await POST(createRequest({ name: 'untitled.md' }), routeContext)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Insufficient permissions' })
      expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
    }
  )

  it.each(['write', 'admin'])(
    'creates an empty file with defaults for %s users',
    async (permission) => {
      mockGetUserEntityPermissions.mockResolvedValue(permission)
      const request = createRequest({ name: 'untitled.md' })

      const response = await POST(request, routeContext)
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body).toMatchObject({ success: true, file: { id: CREATED_FILE.id } })
      expect(mockPerformCreateWorkspaceFile).toHaveBeenCalledTimes(1)
      const params = mockPerformCreateWorkspaceFile.mock.calls[0][0]
      expect(params).toMatchObject({
        workspaceId: WORKSPACE_ID,
        userId: USER.id,
        actorName: USER.name,
        actorEmail: USER.email,
        name: 'untitled.md',
        contentType: 'text/markdown',
        exactName: false,
      })
      expect(params.folderId).toBeUndefined()
      expect(params.content).toEqual(Buffer.alloc(0))
      expect(params.request).toBe(request)
    }
  )

  it('decodes initialized base64 content and preserves folder and content type', async () => {
    const content = Buffer.from([0, 1, 2, 255])
    const request = createRequest({
      name: 'data.bin',
      contentType: 'application/octet-stream',
      folderId: 'folder-1',
      content: content.toString('base64'),
      encoding: 'base64',
    })
    mockPerformCreateWorkspaceFile.mockResolvedValue({
      success: true,
      file: {
        ...CREATED_FILE,
        name: 'data.bin',
        type: 'application/octet-stream',
        size: content.length,
        folderId: 'folder-1',
      },
    })

    const response = await POST(request, routeContext)

    expect(response.status).toBe(201)
    expect(mockPerformCreateWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        name: 'data.bin',
        contentType: 'application/octet-stream',
        folderId: 'folder-1',
        content,
        exactName: false,
      })
    )
  })

  it('rejects malformed base64 after authorization and before orchestration', async () => {
    const response = await POST(
      createRequest({ name: 'data.bin', content: 'not-base64!', encoding: 'base64' }),
      routeContext
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Validation error' })
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(USER.id, 'workspace', WORKSPACE_ID)
    expect(mockPerformCreateWorkspaceFile).not.toHaveBeenCalled()
  })

  it('accepts empty base64 as a zero-byte file', async () => {
    const response = await POST(
      createRequest({ name: 'empty.bin', content: '', encoding: 'base64' }),
      routeContext
    )

    expect(response.status).toBe(201)
    expect(mockPerformCreateWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ content: Buffer.alloc(0) })
    )
  })

  it.each([
    ['validation', 400, 'Invalid file name'],
    ['not_found', 404, 'Target folder not found'],
    ['conflict', 409, 'A file with this name already exists'],
    ['payload_too_large', 413, 'File size exceeds 50MB limit'],
  ] as const)('maps a %s orchestration failure to %i', async (errorCode, expectedStatus, error) => {
    mockPerformCreateWorkspaceFile.mockResolvedValue({ success: false, error, errorCode })

    const response = await POST(createRequest({ name: 'untitled.md' }), routeContext)

    expect(response.status).toBe(expectedStatus)
    await expect(response.json()).resolves.toEqual({ success: false, error })
  })

  it('does not expose an internal orchestration error', async () => {
    mockPerformCreateWorkspaceFile.mockResolvedValue({
      success: false,
      error: 'update workspace_files set ... failed',
      errorCode: 'internal',
    })

    const response = await POST(createRequest({ name: 'untitled.md' }), routeContext)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Failed to create file',
    })
  })

  it('maps an unexpected throw to a 500 response', async () => {
    mockPerformCreateWorkspaceFile.mockRejectedValue(new Error('storage unavailable'))

    const response = await POST(createRequest({ name: 'untitled.md' }), routeContext)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Failed to create file',
    })
  })
})
