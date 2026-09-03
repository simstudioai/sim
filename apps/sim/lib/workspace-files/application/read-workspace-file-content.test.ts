/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchBuffer: vi.fn(),
  getFile: vi.fn(),
  getSecretProvenance: vi.fn(),
  loadContext: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchBuffer,
  getWorkspaceFile: mocks.getFile,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mocks.getSecretProvenance,
}))

import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'

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
  name: 'source.txt',
  key: 'workspace/workspace-1/source.txt',
  size: 12,
}

describe('readWorkspaceFileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.getFile.mockResolvedValue(file)
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('source'))
    mocks.getSecretProvenance.mockResolvedValue({ status: 'exact', entries: [] })
  })

  it('authorizes the canonical file before performing a bounded content read', async () => {
    await expect(
      readWorkspaceFileContent.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          fileId: 'file-1',
          assertedWorkspaceId: 'workspace-1',
          includeDeleted: true,
          maxBytes: 512,
        },
      })
    ).resolves.toEqual({ file, content: Buffer.from('source') })

    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', {
      includeDeleted: true,
      includeChatUploads: true,
    })
    expect(mocks.getFile).toHaveBeenCalledWith('workspace-1', 'file-1', {
      includeDeleted: true,
      throwOnError: true,
      includeChatUploads: true,
    })
    expect(mocks.fetchBuffer).toHaveBeenCalledWith(file, { maxBytes: 512 })
    expect(mocks.getSecretProvenance).not.toHaveBeenCalled()
  })

  it('loads bound provenance only when requested after the authorized content read', async () => {
    const secretProvenance = {
      status: 'exact' as const,
      entries: [{ encryptedValue: 'ciphertext', sourceUserId: 'user-1' }],
    }
    mocks.getSecretProvenance.mockResolvedValue(secretProvenance)

    await expect(
      readWorkspaceFileContent.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          fileId: 'file-1',
          assertedWorkspaceId: 'workspace-1',
          includeSecretProvenance: true,
        },
      })
    ).resolves.toEqual({ file, content: Buffer.from('source'), secretProvenance })

    expect(mocks.fetchBuffer).toHaveBeenCalledBefore(mocks.getSecretProvenance)
    expect(mocks.getSecretProvenance).toHaveBeenCalledWith('workspace-1', {
      fileId: 'file-1',
      key: file.key,
      context: 'workspace',
    })
  })

  it('conceals an asserted-workspace mismatch before authorization or storage reads', async () => {
    await expect(
      readWorkspaceFileContent.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'File not found' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })
})
