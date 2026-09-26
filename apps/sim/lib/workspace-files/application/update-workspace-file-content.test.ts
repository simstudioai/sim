import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  MockContentVersionConflictError,
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { workspaceUploadsMock } from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Both specifiers are mocked: the context resolver imports the manager directly, not the barrel. */
vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@sim/audit', () => auditMock)

import type { Principal } from '@sim/auth/principal'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { updateWorkspaceFileContent } from '@/lib/workspace-files/application/update-workspace-file-content'

const {
  mockGetWorkspaceFileWithCurrentVersion,
  mockUpdateWorkspaceFileContent: mockUpdateStoredContent,
  mockLoadActiveWorkspaceFileContext,
  mockLoadWorkspaceFileLifecycleContext,
} = workspaceFileManagerMockFns
mockLoadWorkspaceFileLifecycleContext.mockImplementation((...args: unknown[]) =>
  mockLoadActiveWorkspaceFileContext(...args)
)

const mockAssertActiveWorkspaceAccess = permissionsMockFns.mockAssertActiveWorkspaceAccess

const mockResolveEffectiveWorkspacePermission =
  workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const CONTENT_UPDATED_AT = new Date('2026-01-01T00:00:00.000Z')

const principal: Principal = createSessionPrincipal()

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
    mockUpdateStoredContent.mockRejectedValueOnce(new MockContentVersionConflictError('stale'))

    await expect(write(workspaceFileRevision(storedFile()))).rejects.toMatchObject({
      code: 'conflict',
    })
  })
})
