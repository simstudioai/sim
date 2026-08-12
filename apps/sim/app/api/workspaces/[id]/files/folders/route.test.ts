/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.captureServerEvent }))
vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  listWorkspaceFileFoldersOperation: {
    operation: { id: 'files.folders.list', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.listFolders,
  },
  createWorkspaceFileFolderOperation: {
    operation: { id: 'files.folders.create', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.createFolder,
  },
}))

import { WorkspaceFileFolderConflictError } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { GET, POST } from '@/app/api/workspaces/[id]/files/folders/route'

const WORKSPACE_ID = 'workspace-1'
const context = { params: Promise.resolve({ id: WORKSPACE_ID }) }
const folder = {
  id: 'folder-1',
  workspaceId: WORKSPACE_ID,
  userId: 'user-1',
  name: 'Reports',
  parentId: null,
  path: '/Reports',
  sortOrder: 0,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}
const serializedFolder = {
  ...folder,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function request(method: 'GET' | 'POST', body?: unknown) {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/folders`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
}

describe('/api/workspaces/[id]/files/folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mocks.listFolders.mockResolvedValue({ folders: [folder] })
    mocks.createFolder.mockResolvedValue({ folder })
  })

  it('authenticates before listing folders', async () => {
    mocks.getSession.mockResolvedValueOnce(null)

    const response = await GET(request('GET'), context)

    expect(response.status).toBe(401)
    expect(mocks.listFolders).not.toHaveBeenCalled()
  })

  it('lists folders through the shared use case', async () => {
    const response = await GET(request('GET'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, folders: [serializedFolder] })
    expect(mocks.listFolders).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: WORKSPACE_ID, scope: 'active' },
      request: expect.anything(),
    })
  })

  it('creates a folder and preserves the internal success event', async () => {
    const response = await POST(request('POST', { name: 'Reports' }), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, folder: serializedFolder })
    expect(mocks.createFolder).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: WORKSPACE_ID, name: 'Reports', parentId: undefined },
      request: expect.anything(),
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'folder_created',
      { workspace_id: WORKSPACE_ID },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })

  it('returns conflict when a sibling folder has the requested name', async () => {
    mocks.createFolder.mockRejectedValueOnce(new WorkspaceFileFolderConflictError('Reports'))

    const response = await POST(request('POST', { name: 'Reports' }), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'A folder named "Reports" already exists in this location',
    })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it('rejects an invalid folder name before the use case', async () => {
    const response = await POST(request('POST', { name: 'nested/name' }), context)

    expect(response.status).toBe(400)
    expect(mocks.createFolder).not.toHaveBeenCalled()
  })
})
