import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ flag: vi.fn() }))
vi.mock('@/lib/dashboards/feature-flag', () => ({ requireDashboardsEnabled: hoisted.flag }))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

import {
  createDashboard,
  deleteDashboard,
  listDashboards,
  moveDashboard,
  readDashboard,
  updateDashboard,
} from '@/lib/dashboards/application/dashboards'
import { ContentVersionConflictError } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'

const mocks = {
  flag: hoisted.flag,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  context: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  workspace: workspaceFileManagerMockFns.mockLoadActiveWorkspaceContext,
  file: workspaceFileManagerMockFns.mockGetWorkspaceFile,
  list: workspaceFileManagerMockFns.mockQueryWorkspaceFiles,
  buffer: workspaceFileManagerMockFns.mockFetchWorkspaceFileBuffer,
  upload: workspaceFileManagerMockFns.mockUploadWorkspaceFile,
  update: workspaceFileManagerMockFns.mockUpdateWorkspaceFileContent,
}

const principal = { kind: 'session' as const, userId: 'actor', sessionId: 'session' }
const workspace = {
  workspaceId: 'ws-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}
const input = { workspaceId: 'ws-1', dashboardId: 'dash-1' }
const file = {
  id: 'dash-1',
  workspaceId: 'ws-1',
  name: 'Support.dashboard',
  type: 'text/x-sim-dashboard',
  uploadedAt: new Date('2026-09-24T00:00:00Z'),
  updatedAt: new Date('2026-09-24T00:00:00Z'),
  folderId: null,
  folderPath: null,
}
const content = 'title: Support\nblocks:\n  - text: Hello'
const expectedRevision = workspaceFileRevision(file)!

beforeEach(() => {
  mocks.flag.mockResolvedValue(undefined)
  mocks.permission.mockResolvedValue('admin')
  mocks.workspace.mockResolvedValue(workspace)
  mocks.context.mockResolvedValue({ ...workspace, fileId: 'dash-1' })
  mocks.file.mockResolvedValue(file)
  mocks.upload.mockResolvedValue(file)
  mocks.update.mockResolvedValue(file)
  mocks.list.mockResolvedValue({ files: [file], nextKeys: null })
  mocks.buffer.mockResolvedValue(Buffer.from(content))
})

describe('dashboard application boundary', () => {
  it('refuses every operation when dashboards are disabled', async () => {
    mocks.flag.mockRejectedValue(new Error('Dashboards are not enabled'))
    const attempts = [
      () => listDashboards.execute({ principal, input: { workspaceId: 'ws-1' } }),
      () => readDashboard.execute({ principal, input }),
      () =>
        createDashboard.execute({
          principal,
          input: { workspaceId: 'ws-1', name: 'Support', content },
        }),
      () => updateDashboard.execute({ principal, input: { ...input, content, expectedRevision } }),
      () => moveDashboard.execute({ principal, input: { ...input, name: 'Renamed' } }),
      () => deleteDashboard.execute({ principal, input }),
    ]
    for (const attempt of attempts)
      await expect(attempt()).rejects.toThrow('Dashboards are not enabled')
  })

  it('exposes dashboards with a distinct resource identity', async () => {
    const result = await listDashboards.execute({ principal, input: { workspaceId: 'ws-1' } })
    expect(result).toEqual({
      dashboards: [
        expect.objectContaining({
          id: 'dash-1',
          type: 'dashboard',
          name: 'Support',
          path: 'dashboards/Support',
          revision: expectedRevision,
        }),
      ],
      truncated: false,
    })
  })
  it('reads dashboard content', async () => {
    await expect(readDashboard.execute({ principal, input })).resolves.toMatchObject({ content })
  })
  it('refuses a dashboard asserted from another workspace', async () => {
    await expect(
      readDashboard.execute({ principal, input: { ...input, workspaceId: 'other' } })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
  it('refuses revoked workspace access', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(readDashboard.execute({ principal, input })).rejects.toThrow()
  })
  it('does not expose ordinary files through dashboard IDs', async () => {
    mocks.file.mockResolvedValue({ ...file, type: 'text/plain' })
    await expect(readDashboard.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
  })
  it('allows reads but rejects writes for a read-only member', async () => {
    mocks.permission.mockResolvedValue('read')
    await expect(readDashboard.execute({ principal, input })).resolves.toMatchObject({ content })
    await expect(
      updateDashboard.execute({ principal, input: { ...input, content, expectedRevision } })
    ).rejects.toThrow()
  })
  it.each(['title: Broken\nblocks: invalid', 'title: Missing blocks'])(
    'refuses invalid YAML',
    async (content) => {
      await expect(
        createDashboard.execute({
          principal,
          input: { workspaceId: 'ws-1', name: 'Support', content },
        })
      ).rejects.toMatchObject({ code: 'validation' })
    }
  )
  it('rejects a revision issued for a different dashboard', async () => {
    const wrongRevision = workspaceFileRevision({ ...file, id: 'other' })!
    await expect(
      updateDashboard.execute({
        principal,
        input: { ...input, content, expectedRevision: wrongRevision },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })
  it('surfaces concurrent edits as a conflict', async () => {
    mocks.update.mockRejectedValueOnce(new ContentVersionConflictError('changed'))
    await expect(
      updateDashboard.execute({ principal, input: { ...input, content, expectedRevision } })
    ).rejects.toMatchObject({ code: 'conflict' })
  })
  it('does not delete an ordinary file using the dashboard operation', async () => {
    mocks.file.mockResolvedValue({ ...file, type: 'text/plain' })
    await expect(deleteDashboard.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})
