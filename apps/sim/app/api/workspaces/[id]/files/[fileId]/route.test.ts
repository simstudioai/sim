/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  rename: vi.fn(),
  deleteItems: vi.fn(),
  getUserEntityPermissions: vi.fn(),
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/workspace-files/application/rename-workspace-file', () => ({
  renameWorkspaceFile: {
    operation: { id: 'files.rename', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.rename,
  },
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performDeleteWorkspaceFileItems: mocks.deleteItems,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mocks.getUserEntityPermissions,
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.captureServerEvent }))

import {
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PATCH } from '@/app/api/workspaces/[id]/files/[fileId]/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const context = { params: Promise.resolve({ id: WORKSPACE_ID, fileId: FILE_ID }) }

function callRename(body: unknown) {
  return PATCH(
    new NextRequest(`http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context
  )
}

function fileRecord() {
  return {
    id: FILE_ID,
    workspaceId: WORKSPACE_ID,
    name: 'renamed.csv',
    key: 'workspace/ws/file.csv',
    path: '/api/files/serve/file.csv',
    size: 42,
    type: 'text/csv',
    uploadedBy: 'user-1',
    folderId: undefined,
    uploadedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  }
}

describe('PATCH /api/workspaces/[id]/files/[fileId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.rename.mockResolvedValue({ file: fileRecord() })
  })

  it('authenticates before parsing the request', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await callRename({ name: 'nested/invalid.csv' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.rename).not.toHaveBeenCalled()
  })

  it('rejects invalid rename input before the use case', async () => {
    const response = await callRename({ name: 'nested/invalid.csv' })

    expect(response.status).toBe(400)
    expect(mocks.rename).not.toHaveBeenCalled()
  })

  it('passes a session principal and canonical assertion to the shared use case', async () => {
    const response = await callRename({ name: 'renamed.csv' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      file: expect.objectContaining({ id: FILE_ID, name: 'renamed.csv', folderId: null }),
    })
    expect(mocks.rename).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        fileId: FILE_ID,
        assertedWorkspaceId: WORKSPACE_ID,
        name: 'renamed.csv',
      },
      request: expect.anything(),
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'file_renamed',
      { workspace_id: WORKSPACE_ID },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })

  it('renders typed authorization errors in the internal envelope', async () => {
    mocks.rename.mockRejectedValue(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )

    const response = await callRename({ name: 'renamed.csv' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Insufficient workspace permissions',
    })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it.each([
    new NoWorkspaceAccessError(),
    new WorkspaceApiKeyScopeAuthorizationError(),
    new DelegatedWorkspaceAuthorizationError(),
  ])('conceals a cross-tenant denial as an absent file: %s', async (error) => {
    mocks.rename.mockRejectedValue(error)

    const response = await callRename({ name: 'renamed.csv' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'File not found' })
  })

  it('keeps a same-workspace role denial forbidden', async () => {
    mocks.rename.mockRejectedValue(new InsufficientWorkspacePermissionsError())

    const response = await callRename({ name: 'renamed.csv' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Insufficient workspace permissions' })
  })

  it('hides unexpected failures behind the internal 500 envelope', async () => {
    mocks.rename.mockRejectedValue(new Error('update workspace_files failed'))

    const response = await callRename({ name: 'renamed.csv' })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Internal server error',
    })
  })
})
