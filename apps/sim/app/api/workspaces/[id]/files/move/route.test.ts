/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  execute: vi.fn(),
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.captureServerEvent }))
vi.mock('@/lib/workspace-files/application/move-workspace-file-items', () => ({
  moveWorkspaceFileItemsOperation: {
    operation: { id: 'files.move', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.execute,
  },
}))

import { WorkspaceFileMoveConflictError } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { POST } from '@/app/api/workspaces/[id]/files/move/route'

const WORKSPACE_ID = 'workspace-1'
const context = { params: Promise.resolve({ id: WORKSPACE_ID }) }

function request(body: unknown) {
  return new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/workspaces/[id]/files/move', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mocks.execute.mockResolvedValue({ movedItems: { files: 2, folders: 1 } })
  })

  it('moves selected files and folders through the shared operation', async () => {
    const response = await POST(
      request({ fileIds: ['wf_1', 'wf_2'], folderIds: ['folder-1'], targetFolderId: null }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      movedItems: { files: 2, folders: 1 },
    })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: WORKSPACE_ID,
        fileIds: ['wf_1', 'wf_2'],
        folderIds: ['folder-1'],
        targetFolderId: null,
      },
      request: expect.anything(),
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'file_moved',
      { workspace_id: WORKSPACE_ID, file_count: 2, folder_count: 1 },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })

  it('rejects an empty selection before the use case', async () => {
    const response = await POST(request({}), context)

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('returns conflict when the destination already contains the file name', async () => {
    mocks.execute.mockRejectedValueOnce(new WorkspaceFileMoveConflictError('report.csv'))

    const response = await POST(request({ fileIds: ['wf_1'], targetFolderId: null }), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'A file named "report.csv" already exists in the destination folder',
    })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it('authenticates before parsing the selection', async () => {
    mocks.getSession.mockResolvedValueOnce(null)

    const response = await POST(request({ fileIds: ['wf_1'] }), context)

    expect(response.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
