/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchContent: vi.fn(),
  getFile: vi.fn(),
  getMetadata: vi.fn(),
  loadContext: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchContent,
  getWorkspaceFile: mocks.getFile,
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: mocks.getMetadata,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { readWorkspaceFileContentByKey } from '@/lib/workspace-files/application/read-workspace-file-content-by-key'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const context = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}
const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'report.pdf',
  key: 'workspace/workspace-1/report.pdf',
  path: '/api/files/serve/workspace/workspace-1/report.pdf',
  size: 6,
  type: 'text/x-python-pdf',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
}

describe('readWorkspaceFileContentByKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMetadata.mockResolvedValue({
      id: file.id,
      workspaceId: file.workspaceId,
      key: file.key,
      context: 'workspace',
    })
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getFile.mockResolvedValue(file)
    mocks.fetchContent.mockResolvedValue(Buffer.from('source'))
  })

  it('authorizes the canonical file before returning its stored bytes', async () => {
    await expect(
      readWorkspaceFileContentByKey.execute({
        principal,
        input: { key: file.key, assertedWorkspaceId: file.workspaceId },
      })
    ).resolves.toEqual({ file, content: Buffer.from('source') })

    expect(mocks.getFile).toHaveBeenCalledWith(file.workspaceId, file.id, {
      throwOnError: true,
    })
    expect(mocks.fetchContent).toHaveBeenCalledWith(file, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
  })

  it('rejects a stale key instead of serving the file current at the same ID', async () => {
    mocks.getFile.mockResolvedValue({ ...file, key: `${file.key}.new` })

    await expect(
      readWorkspaceFileContentByKey.execute({
        principal,
        input: { key: file.key, assertedWorkspaceId: file.workspaceId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.fetchContent).not.toHaveBeenCalled()
  })
})
