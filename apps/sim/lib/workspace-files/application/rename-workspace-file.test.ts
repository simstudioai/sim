/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  renameStored: vi.fn(),
  resolvePermission: vi.fn(),
  recordAudit: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_UPDATED: 'FILE_UPDATED' },
  AuditResourceType: { FILE: 'FILE' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mocks.notify }))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.loadContext,
  renameWorkspaceFile: mocks.renameStored,
}))

import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'

const canonical = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const mappedFile = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'new.csv',
  key: 'workspace/ws/file.csv',
  path: '/api/files/serve/file.csv',
  size: 42,
  type: 'text/csv',
  uploadedBy: 'uploader-1',
  folderId: null,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

describe('renameWorkspaceFile application service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(canonical)
    mocks.renameStored.mockResolvedValue(mappedFile)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.notify.mockResolvedValue(undefined)
  })

  it('loads, authorizes, renames, then emits side effects', async () => {
    const result = await renameWorkspaceFile.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', name: 'new.csv' },
    })

    expect(result).toEqual({ file: mappedFile })
    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', { includeDeleted: undefined })
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.renameStored).toHaveBeenCalledWith('workspace-1', 'file-1', 'new.csv')
    expect(mocks.renameStored.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordAudit.mock.invocationCallOrder[0]
    )
    expect(mocks.renameStored.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.notify.mock.invocationCallOrder[0]
    )
    expect(mocks.recordAudit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.notify.mock.invocationCallOrder[0]
    )
  })

  it('conceals an asserted-workspace mismatch before authorization or mutation', async () => {
    await expect(
      renameWorkspaceFile.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-2', name: 'new.csv' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'File not found' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.renameStored).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('keeps workspace-key audit attribution non-human', async () => {
    await renameWorkspaceFile.execute({
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
      input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', name: 'new.csv' },
    })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          actor: {
            kind: 'workspace_api_key',
            keyId: 'key-1',
            workspaceId: 'workspace-1',
          },
        }),
      })
    )
  })

  it('propagates a typed rename conflict', async () => {
    const failure = Object.assign(new Error('File already exists'), { code: 'conflict' })
    mocks.renameStored.mockRejectedValueOnce(failure)

    await expect(
      renameWorkspaceFile.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', name: 'new.csv' },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('propagates an infrastructure read failure without classifying it as not found', async () => {
    const failure = new Error('database unavailable')
    mocks.loadContext.mockRejectedValueOnce(failure)

    await expect(
      renameWorkspaceFile.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', name: 'new.csv' },
      })
    ).rejects.toBe(failure)
  })
})
