/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  flag: vi.fn(),
  context: vi.fn(),
  workspace: vi.fn(),
  file: vi.fn(),
  list: vi.fn(),
  buffer: vi.fn(),
  upload: vi.fn(),
  update: vi.fn(),
  move: vi.fn(),
  delete: vi.fn(),
  permission: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('@/lib/dashboards/feature-flag', () => ({ requireDashboardsEnabled: mocks.flag }))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: mocks.permission,
  permissionSatisfies: (actual: string, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.context,
  loadActiveWorkspaceContext: mocks.workspace,
  getWorkspaceFile: mocks.file,
  queryWorkspaceFiles: mocks.list,
  fetchWorkspaceFileBuffer: mocks.buffer,
  uploadWorkspaceFile: mocks.upload,
  updateWorkspaceFileContent: mocks.update,
  moveRenameWorkspaceFile: mocks.move,
  deleteWorkspaceFile: mocks.delete,
  ContentVersionConflictError: class extends Error {},
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mocks.notify }))

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
  vi.clearAllMocks()
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
  it('refuses disabled dashboards before storage reads or writes', async () => {
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
    expect(mocks.flag).toHaveBeenCalledWith(null)
    for (const operation of [
      mocks.list,
      mocks.file,
      mocks.buffer,
      mocks.upload,
      mocks.update,
      mocks.move,
      mocks.delete,
      mocks.notify,
    ]) {
      expect(operation).not.toHaveBeenCalled()
    }
  })

  it('lists only dashboards and exposes a distinct resource identity', async () => {
    const result = await listDashboards.execute({ principal, input: { workspaceId: 'ws-1' } })
    expect(mocks.list).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ resourceType: 'dashboard', limit: 500 })
    )
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
  it('bounds content reads', async () => {
    await expect(readDashboard.execute({ principal, input })).resolves.toMatchObject({ content })
    expect(mocks.buffer).toHaveBeenCalledWith(file, { maxBytes: 131072 })
  })
  it('refuses another workspace before loading content or metadata', async () => {
    await expect(
      readDashboard.execute({ principal, input: { ...input, workspaceId: 'other' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.file).not.toHaveBeenCalled()
    expect(mocks.buffer).not.toHaveBeenCalled()
  })
  it('refuses revoked workspace access before reading the file', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(readDashboard.execute({ principal, input })).rejects.toThrow()
    expect(mocks.file).not.toHaveBeenCalled()
  })
  it('does not expose ordinary files through dashboard IDs', async () => {
    mocks.file.mockResolvedValue({ ...file, type: 'text/plain' })
    await expect(readDashboard.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.buffer).not.toHaveBeenCalled()
  })
  it('allows reads but rejects writes for a read-only member', async () => {
    mocks.permission.mockResolvedValue('read')
    await expect(readDashboard.execute({ principal, input })).resolves.toMatchObject({ content })
    await expect(
      updateDashboard.execute({ principal, input: { ...input, content, expectedRevision } })
    ).rejects.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('validates YAML before persisting a new resource as the acting user', async () => {
    await createDashboard.execute({
      principal,
      input: { workspaceId: 'ws-1', name: 'Support', content, folderId: 'folder-1' },
    })
    expect(mocks.upload).toHaveBeenCalledWith(
      'ws-1',
      'actor',
      Buffer.from(content),
      'Support.dashboard',
      'text/x-sim-dashboard',
      expect.objectContaining({
        folderId: 'folder-1',
        exactName: true,
        notifyWorkspaceChange: false,
      })
    )
    expect(mocks.notify).toHaveBeenCalledOnce()
  })
  it.each(['title: Broken\nblocks: invalid', 'title: Missing blocks'])(
    'refuses invalid YAML without creating storage',
    async (content) => {
      await expect(
        createDashboard.execute({
          principal,
          input: { workspaceId: 'ws-1', name: 'Support', content },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(mocks.upload).not.toHaveBeenCalled()
      expect(mocks.notify).not.toHaveBeenCalled()
    }
  )
  it('guards edits with the exact content revision and preserves secret provenance', async () => {
    await updateDashboard.execute({ principal, input: { ...input, content, expectedRevision } })
    expect(mocks.update).toHaveBeenCalledWith(
      'ws-1',
      'dash-1',
      'actor',
      Buffer.from(content),
      'text/x-sim-dashboard',
      expect.objectContaining({
        expectedUpdatedAt: file.updatedAt,
        secretProvenancePolicy: { mode: 'preserve' },
        version: expect.objectContaining({ authorUserId: 'actor' }),
      })
    )
  })
  it('rejects a revision issued for a different dashboard', async () => {
    const wrongRevision = workspaceFileRevision({ ...file, id: 'other' })!
    await expect(
      updateDashboard.execute({
        principal,
        input: { ...input, content, expectedRevision: wrongRevision },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('surfaces concurrent edits as a conflict without publishing a change', async () => {
    mocks.update.mockRejectedValueOnce(new ContentVersionConflictError('changed'))
    await expect(
      updateDashboard.execute({ principal, input: { ...input, content, expectedRevision } })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('renames and moves in one mutation and does not notify a no-op', async () => {
    mocks.move.mockResolvedValue({ file, renamed: false, moved: false })
    await moveDashboard.execute({ principal, input })
    expect(mocks.move).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      fileId: 'dash-1',
      newName: 'Support.dashboard',
      targetFolderId: null,
    })
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('does not delete an ordinary file using the dashboard operation', async () => {
    mocks.file.mockResolvedValue({ ...file, type: 'text/plain' })
    await expect(deleteDashboard.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.delete).not.toHaveBeenCalled()
  })
})
