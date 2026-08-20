/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permanentlyDelete: vi.fn(),
  resolvePermission: vi.fn(),
  resolveContext: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workspace-files/application/workspace-file-context', () => ({
  resolveWorkspaceFileLifecycleContext: mocks.resolveContext,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  permanentlyDeleteWorkspaceFile: mocks.permanentlyDelete,
}))

vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mocks.notify }))

import { permanentlyDeleteWorkspaceFileOperation } from '@/lib/workspace-files/application/permanently-delete-workspace-file'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_doomed'

function lifecycleContext(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    fileId: FILE_ID,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner-1',
    deletedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

const sessionPrincipal: Principal = {
  kind: 'session',
  userId: 'user-1',
  sessionId: 'session-1',
}
const personalKeyPrincipal: Principal = {
  kind: 'personal_api_key',
  userId: 'user-1',
  keyId: 'key-1',
}
const workspaceKeyPrincipal: Principal = {
  kind: 'workspace_api_key',
  workspaceId: WORKSPACE_ID,
  keyId: 'key-2',
}

function input() {
  return { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID }
}

describe('permanentlyDeleteWorkspaceFileOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolveContext.mockResolvedValue(lifecycleContext())
    mocks.notify.mockResolvedValue(undefined)
    mocks.permanentlyDelete.mockResolvedValue({
      file: { id: FILE_ID, name: 'doomed.pdf', key: 'workspace/ws/doomed.pdf' },
      objectDeleted: true,
    })
  })

  it.each([sessionPrincipal, personalKeyPrincipal])(
    'allows $kind at the admin role',
    async (principal) => {
      const result = await permanentlyDeleteWorkspaceFileOperation.execute({
        principal,
        input: input(),
      })

      expect(result).toMatchObject({ id: FILE_ID, deleted: true, objectDeleted: true })
    }
  )

  /**
   * `admin` forces `workspaceApiKey: 'deny'` — the workspace-key ceiling is
   * `write`. Irreversible destruction must not be reachable by an unattended
   * credential.
   */
  it('rejects a workspace API key before loading anything', async () => {
    await expect(
      permanentlyDeleteWorkspaceFileOperation.execute({
        principal: workspaceKeyPrincipal,
        input: input(),
      })
    ).rejects.toThrow()

    expect(mocks.resolveContext).not.toHaveBeenCalled()
    expect(mocks.permanentlyDelete).not.toHaveBeenCalled()
  })

  it.each(['read', 'write'])('rejects a principal holding only %s', async (role) => {
    mocks.resolvePermission.mockResolvedValue(role)

    await expect(
      permanentlyDeleteWorkspaceFileOperation.execute({
        principal: sessionPrincipal,
        input: input(),
      })
    ).rejects.toThrow()
    expect(mocks.permanentlyDelete).not.toHaveBeenCalled()
  })

  /**
   * The two-step precondition: destruction is only reachable for a file that a
   * previous request already archived.
   */
  it('refuses a live file and names the archive step', async () => {
    mocks.resolveContext.mockResolvedValueOnce(lifecycleContext({ deletedAt: null }))

    await expect(
      permanentlyDeleteWorkspaceFileOperation.execute({
        principal: sessionPrincipal,
        input: input(),
      })
    ).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining(`DELETE /api/v2/files/${FILE_ID}`),
    })
    expect(mocks.permanentlyDelete).not.toHaveBeenCalled()
  })

  it('resolves the file canonically before authorizing', async () => {
    mocks.resolveContext.mockRejectedValueOnce(
      Object.assign(new Error('File not found'), { code: 'not_found' })
    )

    await expect(
      permanentlyDeleteWorkspaceFileOperation.execute({
        principal: sessionPrincipal,
        input: input(),
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })

  /**
   * Failure injection on the object leg. The row is already gone, so the
   * request has genuinely succeeded; the orphaned object is reported rather
   * than turned into an error the caller would pointlessly retry.
   */
  it('succeeds and reports the orphan when the object delete fails', async () => {
    mocks.permanentlyDelete.mockResolvedValueOnce({
      file: { id: FILE_ID, name: 'doomed.pdf', key: 'workspace/ws/doomed.pdf' },
      objectDeleted: false,
    })

    const result = await permanentlyDeleteWorkspaceFileOperation.execute({
      principal: sessionPrincipal,
      input: input(),
    })

    expect(result).toMatchObject({ deleted: true, objectDeleted: false })
  })

  /**
   * Failure injection on the row leg. Nothing was destroyed, so the failure
   * propagates and no success side effect runs.
   */
  it('propagates a row-delete failure without notifying', async () => {
    mocks.permanentlyDelete.mockRejectedValueOnce(new Error('deadlock detected'))

    await expect(
      permanentlyDeleteWorkspaceFileOperation.execute({
        principal: sessionPrincipal,
        input: input(),
      })
    ).rejects.toThrow('deadlock detected')

    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('notifies collaborators after a successful destruction', async () => {
    await permanentlyDeleteWorkspaceFileOperation.execute({
      principal: sessionPrincipal,
      input: input(),
    })

    expect(mocks.notify).toHaveBeenCalledWith(WORKSPACE_ID)
  })
})
