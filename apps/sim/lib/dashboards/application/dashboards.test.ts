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
  readWorkspaceDashboard,
  saveWorkspaceDashboard,
} from '@/lib/dashboards/application/dashboards'
import {
  ContentVersionConflictError,
  FileConflictError,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'

const mocks = {
  flag: hoisted.flag,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  workspace: workspaceFileManagerMockFns.mockLoadActiveWorkspaceContext,
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
const input = { workspaceId: 'ws-1' }
const file = {
  id: 'dash-1',
  workspaceId: 'ws-1',
  name: 'Dashboard.dashboard',
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
  mocks.upload.mockResolvedValue(file)
  mocks.update.mockResolvedValue(file)
  mocks.list.mockResolvedValue({ files: [file], nextKeys: null })
  mocks.buffer.mockResolvedValue(Buffer.from(content))
})

describe('workspace dashboard', () => {
  it('refuses every operation when dashboards are disabled', async () => {
    mocks.flag.mockRejectedValue(new Error('Dashboards are not enabled'))
    for (const attempt of [
      () => readWorkspaceDashboard.execute({ principal, input }),
      () => saveWorkspaceDashboard.execute({ principal, input: { ...input, content } }),
    ])
      await expect(attempt()).rejects.toThrow('Dashboards are not enabled')
  })

  it('reads an absent dashboard as empty rather than an error', async () => {
    mocks.list.mockResolvedValue({ files: [], nextKeys: null })
    await expect(readWorkspaceDashboard.execute({ principal, input })).resolves.toEqual({
      dashboard: null,
      content: null,
    })
  })

  it('reads the dashboard with its revision', async () => {
    await expect(readWorkspaceDashboard.execute({ principal, input })).resolves.toMatchObject({
      dashboard: { id: 'dash-1', type: 'dashboard', name: 'Dashboard', revision: expectedRevision },
      content,
    })
  })

  it('creates the dashboard on the first save', async () => {
    mocks.list.mockResolvedValue({ files: [], nextKeys: null })
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content } })
    ).resolves.toMatchObject({ created: true, dashboard: { id: 'dash-1' } })
  })

  it('refuses to replace an existing dashboard without its revision', async () => {
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content } })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('refuses a revision for a dashboard deleted after it was read', async () => {
    mocks.list.mockResolvedValue({ files: [], nextKeys: null })
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content, expectedRevision } })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('surfaces a concurrent first save as a conflict', async () => {
    mocks.list.mockResolvedValue({ files: [], nextKeys: null })
    mocks.upload.mockRejectedValueOnce(new FileConflictError('Dashboard.dashboard'))
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content } })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('replaces the dashboard with its revision and surfaces concurrent edits', async () => {
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content, expectedRevision } })
    ).resolves.toMatchObject({ created: false })
    mocks.update.mockRejectedValueOnce(new ContentVersionConflictError('changed'))
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content, expectedRevision } })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects a revision issued for a different file', async () => {
    const wrongRevision = workspaceFileRevision({ ...file, id: 'other' })!
    await expect(
      saveWorkspaceDashboard.execute({
        principal,
        input: { ...input, content, expectedRevision: wrongRevision },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it.each(['title: Broken\nblocks: invalid', 'title: Missing blocks'])(
    'refuses invalid YAML',
    async (invalid) => {
      await expect(
        saveWorkspaceDashboard.execute({ principal, input: { ...input, content: invalid } })
      ).rejects.toMatchObject({ code: 'validation' })
    }
  )

  it('lets a read-only member read but not save', async () => {
    mocks.permission.mockResolvedValue('read')
    await expect(readWorkspaceDashboard.execute({ principal, input })).resolves.toMatchObject({
      content,
    })
    await expect(
      saveWorkspaceDashboard.execute({ principal, input: { ...input, content, expectedRevision } })
    ).rejects.toThrow()
  })
})
