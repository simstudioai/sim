/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAcquireLock,
  mockReleaseLock,
  mockGetWorkspaceFile,
  mockFetchWorkspaceFileBuffer,
  mockUpdateStoredContent,
  mockResolveEffectiveWorkspacePermission,
  mockAssertActiveWorkspaceAccess,
  mockLoadActiveWorkspaceFileContext,
} = vi.hoisted(() => ({
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockUpdateStoredContent: vi.fn(),
  mockResolveEffectiveWorkspacePermission: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockLoadActiveWorkspaceFileContext: vi.fn(),
}))

const { ContentVersionConflictError } = vi.hoisted(() => ({
  ContentVersionConflictError: class ContentVersionConflictError extends Error {},
}))

vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: (...args: unknown[]) => mockAcquireLock(...args),
  releaseLock: (...args: unknown[]) => mockReleaseLock(...args),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  ContentVersionConflictError,
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
  updateWorkspaceFileContent: (...args: unknown[]) => mockUpdateStoredContent(...args),
  loadActiveWorkspaceFileContext: (...args: unknown[]) =>
    mockLoadActiveWorkspaceFileContext(...args),
}))

/*
 * The context resolver imports straight from the manager, not the barrel, so
 * mocking only one of the two leaves the branch under test unreachable.
 */
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  ContentVersionConflictError,
  getWorkspaceFile: (...args: unknown[]) => mockGetWorkspaceFile(...args),
  fetchWorkspaceFileBuffer: (...args: unknown[]) => mockFetchWorkspaceFileBuffer(...args),
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

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { editWorkspaceFileContent } from '@/lib/workspace-files/application/edit-workspace-file-content'

const CONTENT_UPDATED_AT = new Date('2025-01-01T00:00:00.000Z')

const principal = {
  kind: 'session' as const,
  userId: 'user-1',
  subject: { kind: 'user' as const, userId: 'user-1' },
}

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
    ...overrides,
  }
}

async function edit(edit: Record<string, unknown>) {
  return editWorkspaceFileContent.execute({
    // biome-ignore lint/suspicious/noExplicitAny: narrow principal fixture
    principal: principal as any,
    // biome-ignore lint/suspicious/noExplicitAny: narrow input fixture
    input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', edit } as any,
  })
}

describe('editWorkspaceFileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mockGetWorkspaceFile.mockResolvedValue(storedFile())
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from(NOTE, 'utf-8'))
    mockUpdateStoredContent.mockImplementation(async () => storedFile())
  })

  it('writes back only the changed text', async () => {
    await edit({ mode: 'replace_string', oldString: 'based in NYC', newString: 'based in SF' })

    const written = mockUpdateStoredContent.mock.calls[0][3] as Buffer
    expect(written.toString('utf-8')).toBe('# self\n\n- prefers async\n- based in SF\n')
  })

  it('reports the line count so a caller can re-anchor', async () => {
    const result = await edit({ mode: 'insert_lines', afterLine: 4, content: '- vegetarian' })

    expect(result.lineCount).toBe(5)
  })

  /*
   * The real concurrency guard. Two agents editing the same note both read the
   * same bytes; without this the second silently discards the first's change.
   */
  it('sends the version it read as the expected version', async () => {
    await edit({ mode: 'replace_string', oldString: 'NYC', newString: 'SF' })

    expect(mockUpdateStoredContent.mock.calls[0][5]).toMatchObject({
      expectedUpdatedAt: CONTENT_UPDATED_AT,
    })
  })

  it('surfaces a losing race as a conflict rather than a crash', async () => {
    mockUpdateStoredContent.mockRejectedValue(new ContentVersionConflictError('stale'))

    await expect(
      edit({ mode: 'replace_string', oldString: 'NYC', newString: 'SF' })
    ).rejects.toThrow(OrchestrationError)
  })

  it('refuses a file with no recorded content version', async () => {
    mockGetWorkspaceFile.mockResolvedValue(storedFile({ contentUpdatedAt: null }))

    await expect(
      edit({ mode: 'replace_string', oldString: 'NYC', newString: 'SF' })
    ).rejects.toThrow(/content version/)
    expect(mockUpdateStoredContent).not.toHaveBeenCalled()
  })

  /*
   * A string replace across a zip container would corrupt it silently, and a
   * DOCX is a zip. Editing works on stored bytes, so anything that is not text
   * has no lines to edit.
   */
  it('refuses a file that is not text', async () => {
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x00, 0xff]))

    await expect(edit({ mode: 'replace_string', oldString: 'PK', newString: 'x' })).rejects.toThrow(
      /not a text file/
    )
    expect(mockUpdateStoredContent).not.toHaveBeenCalled()
  })

  it('preserves the existing provenance instead of replacing it', async () => {
    await edit({ mode: 'replace_string', oldString: 'NYC', newString: 'SF' })

    expect(mockUpdateStoredContent.mock.calls[0][5]).toMatchObject({
      secretProvenancePolicy: { mode: 'preserve' },
    })
  })

  it('refuses to start when another edit holds the file', async () => {
    mockAcquireLock.mockResolvedValue(false)

    await expect(
      edit({ mode: 'replace_string', oldString: 'NYC', newString: 'SF' })
    ).rejects.toThrow(/busy/)
    expect(mockFetchWorkspaceFileBuffer).not.toHaveBeenCalled()
  })

  /* A refused edit must not leave the file locked for the next 30 seconds. */
  it('releases the lock even when the edit is refused', async () => {
    await expect(
      edit({ mode: 'replace_string', oldString: 'nowhere in the file', newString: 'x' })
    ).rejects.toThrow()

    expect(mockReleaseLock).toHaveBeenCalled()
  })

  it('surfaces an ambiguous match as a validation failure naming the lines', async () => {
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('- todo\nx\n- todo\n', 'utf-8'))

    await expect(
      edit({ mode: 'replace_string', oldString: '- todo', newString: '- done' })
    ).rejects.toThrow(/lines 1, 3/)
    expect(mockUpdateStoredContent).not.toHaveBeenCalled()
  })
})
