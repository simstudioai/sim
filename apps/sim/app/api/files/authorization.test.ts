/**
 * Tests for KB file authorization (`verifyKBFileAccess` via `verifyFileAccess`).
 *
 * These lock in the security-critical contract: access is granted only when a
 * trusted ownership binding names a workspace the caller can access AND an active
 * document still references the exact key. A planted `document.fileUrl` (the
 * reported vulnerability) can never grant access because ownership comes from the
 * binding, not the document.
 *
 * @vitest-environment node
 */
import { dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFileMetadataByKey, mockGetUserEntityPermissions, mockGetFileMetadata } = vi.hoisted(
  () => ({
    mockGetFileMetadataByKey: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockGetFileMetadata: vi.fn(),
  })
)

vi.mock('@/lib/uploads', () => ({
  getFileMetadata: mockGetFileMetadata,
}))

vi.mock('@/lib/uploads/config', () => ({
  getStorageConfig: vi.fn(() => ({})),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: mockGetFileMetadataByKey,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  inferContextFromKey: vi.fn(() => 'knowledge-base'),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/executor/constants', () => ({
  isUuid: vi.fn(() => false),
}))

import { verifyFileAccess, verifyKBFileWriteAccess } from '@/app/api/files/authorization'

const CLOUD_KEY = 'kb/1780162789495-secret.txt'
const USER_ID = 'user-1'

function grantAccess(cloudKey: string) {
  return verifyFileAccess(cloudKey, USER_ID, undefined, 'knowledge-base')
}

describe('verifyKBFileAccess (binding-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default liveness query result: one active document references the exact storage key.
    dbChainMockFns.limit.mockResolvedValue([{ id: 'doc-1' }])
  })

  it('grants access when the binding owner workspace is accessible and an active document references the key', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue('read')

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(true)
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(USER_ID, 'workspace', 'ws-1')
  })

  it('denies when the caller lacks permission on the owner workspace (cross-tenant)', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'victim-ws', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue(null)

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
  })

  it('denies when there is no ownership binding (planted or un-backfilled key)', async () => {
    mockGetFileMetadataByKey.mockResolvedValue(null)

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
    // Authorization never consults workspace permissions without a binding.
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies when the binding is soft-deleted', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: new Date() })

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies when the binding has no workspace owner', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: null, deletedAt: null })

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies when no active document references the key (archived/soft-deleted KB liveness)', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    dbChainMockFns.limit.mockResolvedValue([])

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
  })

  it('fails closed when the binding lookup throws', async () => {
    mockGetFileMetadataByKey.mockRejectedValue(new Error('db down'))

    await expect(grantAccess(CLOUD_KEY)).resolves.toBe(false)
  })
})

describe('verifyKBFileWriteAccess (binding-only delete authorization)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('grants delete when the caller has write on the owner workspace', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue('write')

    await expect(verifyKBFileWriteAccess(CLOUD_KEY, USER_ID)).resolves.toBe(true)
  })

  it('grants delete when the caller is admin on the owner workspace', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    await expect(verifyKBFileWriteAccess(CLOUD_KEY, USER_ID)).resolves.toBe(true)
  })

  it('denies delete when the caller has only read on the owner workspace', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1', deletedAt: null })
    mockGetUserEntityPermissions.mockResolvedValue('read')

    await expect(verifyKBFileWriteAccess(CLOUD_KEY, USER_ID)).resolves.toBe(false)
  })

  it('denies delete when there is no binding (no fallback)', async () => {
    mockGetFileMetadataByKey.mockResolvedValue(null)

    await expect(verifyKBFileWriteAccess(CLOUD_KEY, USER_ID)).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('fails closed when the binding lookup throws', async () => {
    mockGetFileMetadataByKey.mockRejectedValue(new Error('db down'))

    await expect(verifyKBFileWriteAccess(CLOUD_KEY, USER_ID)).resolves.toBe(false)
  })
})

describe('public-context access (profile-pictures / og-images / workspace-logos)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function read(cloudKey: string, context: 'profile-pictures' | 'og-images' | 'workspace-logos') {
    return verifyFileAccess(cloudKey, USER_ID, undefined, context, false)
  }

  function write(cloudKey: string, context: 'profile-pictures' | 'og-images' | 'workspace-logos') {
    return verifyFileAccess(cloudKey, USER_ID, undefined, context, false, { requireWrite: true })
  }

  it('grants public reads without any ownership check', async () => {
    await expect(read('og-images/banner.png', 'og-images')).resolves.toBe(true)
    await expect(read('profile-pictures/123-avatar.png', 'profile-pictures')).resolves.toBe(true)
    await expect(read('workspace-logos/123-logo.png', 'workspace-logos')).resolves.toBe(true)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockGetFileMetadata).not.toHaveBeenCalled()
  })

  it('denies a cross-tenant delete that names a workspace key under a public context', async () => {
    await expect(write('workspace/victim-ws/123-report.pdf', 'og-images')).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('grants a profile-picture delete only to the owning user', async () => {
    mockGetFileMetadata.mockResolvedValue({ userId: USER_ID })
    await expect(write('profile-pictures/123-avatar.png', 'profile-pictures')).resolves.toBe(true)
  })

  it('denies a profile-picture delete for a non-owner', async () => {
    mockGetFileMetadata.mockResolvedValue({ userId: 'other-user' })
    await expect(write('profile-pictures/123-avatar.png', 'profile-pictures')).resolves.toBe(false)
  })

  it('grants a workspace-logo delete to write/admin on the owning workspace', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'ws-1' })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    await expect(write('workspace-logos/123-logo.png', 'workspace-logos')).resolves.toBe(true)
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(USER_ID, 'workspace', 'ws-1')
  })

  it('denies a workspace-logo delete for a non-member of the owning workspace', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ workspaceId: 'victim-ws' })
    mockGetUserEntityPermissions.mockResolvedValue(null)
    await expect(write('workspace-logos/123-logo.png', 'workspace-logos')).resolves.toBe(false)
  })

  it('denies a workspace-logo delete when no ownership binding exists', async () => {
    mockGetFileMetadataByKey.mockResolvedValue(null)
    await expect(write('workspace-logos/123-logo.png', 'workspace-logos')).resolves.toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
