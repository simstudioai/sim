/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  restoreFolder: vi.fn(),
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.captureServerEvent }))
vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  updateWorkspaceFileFolderOperation: {
    operation: { id: 'files.folders.update', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateFolder,
  },
  deleteWorkspaceFileFolderOperation: {
    operation: { id: 'files.folders.delete', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.deleteFolder,
  },
  restoreWorkspaceFileFolderOperation: {
    operation: { id: 'files.folders.restore', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.restoreFolder,
  },
}))

import {
  WorkspaceFileFolderConflictError,
  WorkspaceFileItemsNotFoundError,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { POST as RESTORE } from '@/app/api/workspaces/[id]/files/folders/[folderId]/restore/route'
import { DELETE, PATCH } from '@/app/api/workspaces/[id]/files/folders/[folderId]/route'

const WORKSPACE_ID = 'workspace-1'
const FOLDER_ID = 'folder-1'
const PRINCIPAL = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const context = {
  params: Promise.resolve({ id: WORKSPACE_ID, folderId: FOLDER_ID }),
}
const folder = {
  id: FOLDER_ID,
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

function request(method: 'PATCH' | 'DELETE' | 'POST', body?: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/folders/${FOLDER_ID}${method === 'POST' ? '/restore' : ''}`,
    {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    }
  )
}

describe('/api/workspaces/[id]/files/folders/[folderId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mocks.updateFolder.mockResolvedValue({ folder })
    mocks.deleteFolder.mockResolvedValue({ deletedItems: { folders: 1, files: 2 } })
    mocks.restoreFolder.mockResolvedValue({
      folder,
      restoredItems: { folders: 1, files: 2 },
    })
  })

  it('updates a folder through the shared use case', async () => {
    const response = await PATCH(request('PATCH', { name: 'Reports' }), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, folder: serializedFolder })
    expect(mocks.updateFolder).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, folderId: FOLDER_ID, name: 'Reports' },
      request: expect.anything(),
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'folder_renamed',
      { workspace_id: WORKSPACE_ID },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })

  it('returns conflict when a folder rename collides', async () => {
    mocks.updateFolder.mockRejectedValueOnce(new WorkspaceFileFolderConflictError('Reports'))

    const response = await PATCH(request('PATCH', { name: 'Reports' }), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'A folder named "Reports" already exists in this location',
    })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it('deletes a folder through the shared use case', async () => {
    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      deletedItems: { folders: 1, files: 2 },
    })
    expect(mocks.deleteFolder).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, folderId: FOLDER_ID },
      request: expect.anything(),
    })
  })

  it('returns not found when deleting an already archived folder', async () => {
    mocks.deleteFolder.mockRejectedValueOnce(new WorkspaceFileItemsNotFoundError([], [FOLDER_ID]))

    const response = await DELETE(request('DELETE'), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: `Workspace file items not found (folders: ${FOLDER_ID})`,
    })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it('restores a folder through the shared use case', async () => {
    const response = await RESTORE(request('POST'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      folder: serializedFolder,
      restoredItems: { folders: 1, files: 2 },
    })
    expect(mocks.restoreFolder).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, folderId: FOLDER_ID },
      request: expect.anything(),
    })
  })

  it('authenticates before parsing a folder mutation', async () => {
    mocks.getSession.mockResolvedValueOnce(null)

    const response = await PATCH(request('PATCH', { name: 'Reports' }), context)

    expect(response.status).toBe(401)
    expect(mocks.updateFolder).not.toHaveBeenCalled()
  })
})
