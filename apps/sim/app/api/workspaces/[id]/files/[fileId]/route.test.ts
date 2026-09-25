import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  rename: vi.fn(),
  read: vi.fn(),
  deleteItems: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-record', () => ({
  readWorkspaceFileContentRecord: {
    operation: { id: 'files.read_content', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: hoisted.read,
  },
}))

vi.mock('@/lib/workspace-files/application/rename-workspace-file', () => ({
  renameWorkspaceFile: {
    operation: { id: 'files.rename', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: hoisted.rename,
  },
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performDeleteWorkspaceFileItems: hoisted.deleteItems,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import {
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { GET, PATCH } from '@/app/api/workspaces/[id]/files/[fileId]/route'

const mocks = {
  ...hoisted,
  getSession: authMockFns.mockGetSession,
  getUserEntityPermissions: permissionsMockFns.mockGetUserEntityPermissions,
  captureServerEvent: posthogServerMockFns.mockCaptureServerEvent,
}

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const context = createRouteContext({ id: WORKSPACE_ID, fileId: FILE_ID })

function callRename(body: unknown) {
  return PATCH(
    createMockRequest({
      method: 'PATCH',
      url: `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}`,
      body,
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
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.rename.mockResolvedValue({ file: fileRecord() })
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
})

describe('GET /api/workspaces/[id]/files/[fileId]', () => {
  const read = () =>
    GET(
      createMockRequest({
        url: `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}`,
      }),
      context
    )
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mocks.read.mockResolvedValue({
      file: { ...fileRecord(), vfsNamespace: 'uploads', storageContext: 'workspace' },
    })
  })
  it('conceals inaccessible uploads', async () => {
    mocks.read.mockRejectedValue(new NoWorkspaceAccessError())
    const response = await read()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'File not found' })
  })
})
