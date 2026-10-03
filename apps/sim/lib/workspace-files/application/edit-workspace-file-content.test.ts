import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  MockContentVersionConflictError,
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { workspaceUploadsMock } from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetWorkspaceFileWithCurrentVersion,
  mockFetchWorkspaceFileBuffer,
  mockUpdateWorkspaceFileContent: mockUpdateStoredContent,
  mockLoadActiveWorkspaceFileContext,
  mockLoadWorkspaceFileLifecycleContext,
} = workspaceFileManagerMockFns
mockLoadWorkspaceFileLifecycleContext.mockImplementation((...args: unknown[]) =>
  mockLoadActiveWorkspaceFileContext(...args)
)

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)

/*
 * The context resolver imports straight from the manager, not the barrel, so
 * mocking only one of the two leaves the branch under test unreachable.
 */
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@sim/audit', () => auditMock)

import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type EditWorkspaceFileContentEdit,
  editWorkspaceFileContent,
} from '@/lib/workspace-files/application/edit-workspace-file-content'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'

const { mockAcquireLock, mockReleaseLock } = redisConfigMockFns

const mockAssertActiveWorkspaceAccess = permissionsMockFns.mockAssertActiveWorkspaceAccess

const mockResolveEffectiveWorkspacePermission =
  workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const CONTENT_UPDATED_AT = new Date('2025-01-01T00:00:00.000Z')

const principal: Principal = createSessionPrincipal()

const NOTE = '# self\n\n- prefers async\n- based in NYC\n'

function storedFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    workspaceId: 'workspace-1',
    name: 'self.md',
    key: 'workspace/workspace-1/self.md',
    type: 'text/markdown',
    size: NOTE.length,
    uploadedBy: 'user-1',
    contentUpdatedAt: CONTENT_UPDATED_AT,
    currentVersion: 4,
    ...overrides,
  }
}

/*
 * Typed against the use case's own input rather than a loose record, so a
 * change to the edit contract fails here at compile time instead of letting
 * these tests keep passing against a shape the operation no longer accepts.
 */
async function edit(edit: EditWorkspaceFileContentEdit, expectedRevision?: string) {
  return editWorkspaceFileContent.execute({
    principal,
    input: {
      fileId: 'file-1',
      assertedWorkspaceId: 'workspace-1',
      edit,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    },
  })
}

describe('editWorkspaceFileContent', () => {
  beforeEach(() => {
    mockAcquireLock.mockResolvedValue(true)
    mockReleaseLock.mockResolvedValue(true)
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
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from(NOTE, 'utf-8'))
    mockUpdateStoredContent.mockImplementation(async () => storedFile())
  })

  /*
   * The real concurrency guard. Two agents editing the same note both read the
   * same bytes; without this the second silently discards the first's change.
   */
  it('sends the version it read as the expected version', async () => {
    await edit({ mode: 'search_replace', search: 'NYC', content: 'SF' })

    expect(mockUpdateStoredContent.mock.calls[0][5]).toMatchObject({
      expectedUpdatedAt: CONTENT_UPDATED_AT,
    })
  })

  /**
   * The caller's own revision, not the one this use case just read: the guard has to cover
   * everything since the content the caller edited against.
   */
  it('guards the write with the revision the caller edited against', async () => {
    const callerRevision = new Date('2024-12-31T00:00:00.000Z')

    await edit(
      { mode: 'search_replace', search: 'NYC', content: 'SF' },
      workspaceFileRevision({ ...storedFile(), contentUpdatedAt: callerRevision })
    )

    expect(mockUpdateStoredContent.mock.calls[0][5]).toMatchObject({
      expectedUpdatedAt: callerRevision,
    })
  })

  it('refuses a revision this surface never issued', async () => {
    await expect(
      edit({ mode: 'search_replace', search: 'NYC', content: 'SF' }, 'not-a-revision')
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockUpdateStoredContent).not.toHaveBeenCalled()
  })

  it('surfaces a losing race as a conflict rather than a crash', async () => {
    mockUpdateStoredContent.mockRejectedValue(new MockContentVersionConflictError('stale'))

    await expect(edit({ mode: 'search_replace', search: 'NYC', content: 'SF' })).rejects.toThrow(
      OrchestrationError
    )
  })

  it('refuses a file with no recorded content version', async () => {
    mockGetWorkspaceFileWithCurrentVersion.mockResolvedValue(storedFile({ contentUpdatedAt: null }))

    await expect(edit({ mode: 'search_replace', search: 'NYC', content: 'SF' })).rejects.toThrow(
      /content version/
    )
    expect(mockUpdateStoredContent).not.toHaveBeenCalled()
  })

  /*
   * A string replace across a zip container would corrupt it silently, and a
   * DOCX is a zip. Editing works on stored bytes, so anything that is not text
   * has no lines to edit.
   */
  it.each([
    ['a NUL byte', [0x50, 0x4b, 0x03, 0x04, 0x00]],
    ['bytes that are not valid UTF-8', [0x50, 0x4b, 0xff, 0xfe, 0x01]],
  ])('refuses a file containing %s', async (_label, bytes) => {
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from(bytes))

    await expect(edit({ mode: 'search_replace', search: 'PK', content: 'x' })).rejects.toThrow(
      /not a text file/
    )
    expect(mockUpdateStoredContent).not.toHaveBeenCalled()
  })

  it('preserves the existing provenance instead of replacing it', async () => {
    await edit({ mode: 'search_replace', search: 'NYC', content: 'SF' })

    expect(mockUpdateStoredContent.mock.calls[0][5]).toMatchObject({
      secretProvenancePolicy: { mode: 'preserve' },
    })
  })

  it('refuses to start when another edit holds the file', async () => {
    mockAcquireLock.mockResolvedValue(false)

    await expect(edit({ mode: 'search_replace', search: 'NYC', content: 'SF' })).rejects.toThrow(
      /busy/
    )
    expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
  })

  /* A refused edit must not leave the file locked for the next 30 seconds. */
  it('releases the lock even when the edit is refused', async () => {
    await expect(
      edit({ mode: 'search_replace', search: 'nowhere in the file', content: 'x' })
    ).rejects.toThrow()

    expect(mockReleaseLock).toHaveBeenCalled()
  })
})
