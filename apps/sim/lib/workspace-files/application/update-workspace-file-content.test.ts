/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetWorkspaceFileWithCurrentVersion,
  mockUpdateStoredContent,
  mockResolveEffectiveWorkspacePermission,
  mockAssertActiveWorkspaceAccess,
  mockLoadActiveWorkspaceFileContext,
} = vi.hoisted(() => ({
  mockGetWorkspaceFileWithCurrentVersion: vi.fn(),
  mockUpdateStoredContent: vi.fn(),
  mockResolveEffectiveWorkspacePermission: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockLoadActiveWorkspaceFileContext: vi.fn(),
}))

const { ContentVersionConflictError } = vi.hoisted(() => ({
  ContentVersionConflictError: class ContentVersionConflictError extends Error {},
}))

/** Both specifiers are mocked: the context resolver imports the manager directly, not the barrel. */
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  ContentVersionConflictError,
  getWorkspaceFileWithCurrentVersion: (...args: unknown[]) =>
    mockGetWorkspaceFileWithCurrentVersion(...args),
  updateWorkspaceFileContent: (...args: unknown[]) => mockUpdateStoredContent(...args),
  loadActiveWorkspaceFileContext: (...args: unknown[]) =>
    mockLoadActiveWorkspaceFileContext(...args),
  loadWorkspaceFileLifecycleContext: (...args: unknown[]) =>
    mockLoadActiveWorkspaceFileContext(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  ContentVersionConflictError,
  getWorkspaceFileWithCurrentVersion: (...args: unknown[]) =>
    mockGetWorkspaceFileWithCurrentVersion(...args),
  updateWorkspaceFileContent: (...args: unknown[]) => mockUpdateStoredContent(...args),
  loadActiveWorkspaceFileContext: (...args: unknown[]) =>
    mockLoadActiveWorkspaceFileContext(...args),
  loadWorkspaceFileLifecycleContext: (...args: unknown[]) =>
    mockLoadActiveWorkspaceFileContext(...args),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' ||
    permission === required ||
    (permission === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: (...args: unknown[]) =>
    mockResolveEffectiveWorkspacePermission(...args),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: (...args: unknown[]) => mockAssertActiveWorkspaceAccess(...args),
  getUserEntityPermissions: vi.fn(),
  isWorkspaceAccessDeniedError: vi.fn(() => false),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_UPDATED: 'file.updated' },
  AuditResourceType: { FILE: 'file' },
  recordAudit: vi.fn(),
}))

import type { Principal } from '@sim/auth/principal'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { updateWorkspaceFileContent } from '@/lib/workspace-files/application/update-workspace-file-content'

const CONTENT_UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')

const principal: Principal = {
  kind: 'session',
  userId: 'user-1',
  sessionId: 'session-1',
}

function storedFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    workspaceId: 'workspace-1',
    name: 'notes.md',
    key: 'workspace/workspace-1/notes.md',
    path: '/api/files/serve/notes.md',
    type: 'text/markdown',
    size: 4,
    uploadedBy: 'user-1',
    uploadedAt: CONTENT_UPDATED_AT,
    updatedAt: CONTENT_UPDATED_AT,
    contentUpdatedAt: CONTENT_UPDATED_AT,
    currentVersion: 4,
    ...overrides,
  }
}

async function write(expectedRevision?: string) {
  return updateWorkspaceFileContent.execute({
    principal,
    input: {
      fileId: 'file-1',
      assertedWorkspaceId: 'workspace-1',
      content: 'next',
      encoding: 'utf-8' as const,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    },
  })
}

describe('updateWorkspaceFileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockLoadActiveWorkspaceFileContext.mockResolvedValue({
      fileId: 'file-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    mockGetWorkspaceFileWithCurrentVersion.mockResolvedValue(storedFile())
    mockUpdateStoredContent.mockImplementation(async () => storedFile({ currentVersion: 5 }))
  })

  it('reports the version its write recorded', async () => {
    await expect(write()).resolves.toMatchObject({ file: { currentVersion: 5 } })
  })

  it('writes unconditionally when the caller sends no revision', async () => {
    await write()

    expect(mockUpdateStoredContent.mock.calls[0][5]).not.toHaveProperty('expectedUpdatedAt')
  })

  /*
   * The revision is the content token the manager already guards on under its row lock, so a
   * conditional write needs no pre-read of its own and cannot race between checking and writing.
   */
  it('guards the write with the content the revision names', async () => {
    await write(workspaceFileRevision(storedFile()))

    expect(mockUpdateStoredContent.mock.calls[0][5]).toMatchObject({
      expectedUpdatedAt: CONTENT_UPDATED_AT,
    })
    expect(mockGetWorkspaceFileWithCurrentVersion).not.toHaveBeenCalled()
  })

  it('refuses a revision this surface never issued', async () => {
    await expect(write('not-a-revision')).rejects.toMatchObject({ code: 'validation' })
    expect(mockUpdateStoredContent).not.toHaveBeenCalled()
  })

  /** A token names one file's content; another file's must not satisfy this write. */
  it('refuses a revision issued for a different file', async () => {
    await expect(
      write(workspaceFileRevision({ ...storedFile(), id: 'file-2' }))
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockUpdateStoredContent).not.toHaveBeenCalled()
  })

  it('surfaces the storage conflict when the content moved on', async () => {
    mockUpdateStoredContent.mockRejectedValueOnce(new ContentVersionConflictError('stale'))

    await expect(write(workspaceFileRevision(storedFile()))).rejects.toMatchObject({
      code: 'conflict',
    })
  })
})
