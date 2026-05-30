/**
 * @vitest-environment node
 *
 * Security regression tests for knowledge-base file authorization.
 *
 * The historical bug: `verifyKBFileAccess` authorized access to a storage object
 * whenever ANY active document's `fileUrl` contained the requested key as a
 * substring, in a workspace the caller could reach. That let a tenant plant a
 * document referencing another tenant's storage key (even via an unrelated
 * external URL) and read/delete the victim's file.
 *
 * These tests pin the fixed behavior: authorization requires a document whose
 * fileUrl canonically resolves to EXACTLY the requested key, and access is
 * decided against the OWNING (earliest) document's workspace only.
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const { mockGetUserEntityPermissions } = vi.hoisted(() => ({
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

const { mockGetFileMetadataByKey } = vi.hoisted(() => ({
  mockGetFileMetadataByKey: vi.fn(),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: mockGetFileMetadataByKey,
}))

vi.mock('@/lib/uploads', () => ({
  getFileMetadata: vi.fn().mockResolvedValue({}),
}))

import { verifyFileAccess } from '@/app/api/files/authorization'

const VICTIM_KEY = 'kb/1780162789495-victim-secret.txt'
const ATTACKER_USER = 'attacker-user'

/** Internal serve URL that legitimately resolves to VICTIM_KEY. */
const internalUrlFor = (key: string) =>
  `/api/files/serve/s3/${encodeURIComponent(key)}?context=knowledge-base`

describe('verifyKBFileAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetFileMetadataByKey.mockResolvedValue(null)
  })

  it('grants access to the workspace that owns the storage key', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: 'ws-owner', fileUrl: internalUrlFor(VICTIM_KEY) },
    ])
    mockGetUserEntityPermissions.mockResolvedValue('read')

    const granted = await verifyFileAccess(VICTIM_KEY, 'owner-user', undefined, 'knowledge-base')

    expect(granted).toBe(true)
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith('owner-user', 'workspace', 'ws-owner')
  })

  it('denies access via an external URL that merely contains the key as a substring', async () => {
    // PoC: a planted external URL containing the victim key must never authorize storage.
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        workspaceId: 'ws-attacker',
        fileUrl: `https://attacker.example/anything/${VICTIM_KEY}/marker`,
      },
    ])
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    const granted = await verifyFileAccess(VICTIM_KEY, ATTACKER_USER, undefined, 'knowledge-base')

    expect(granted).toBe(false)
  })

  it('denies a later document planted in another workspace (ownership pins to earliest doc)', async () => {
    // Ordered by uploadedAt asc: the victim owns the key, so the attacker's later doc is ignored.
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: 'ws-victim', fileUrl: internalUrlFor(VICTIM_KEY) },
      { workspaceId: 'ws-attacker', fileUrl: internalUrlFor(VICTIM_KEY) },
    ])
    mockGetUserEntityPermissions.mockImplementation(
      async (_userId: string, _type: string, workspaceId: string) =>
        workspaceId === 'ws-attacker' ? 'admin' : null
    )

    const granted = await verifyFileAccess(VICTIM_KEY, ATTACKER_USER, undefined, 'knowledge-base')

    expect(granted).toBe(false)
    // Authorization is decided against the owning workspace only.
    expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(
      ATTACKER_USER,
      'workspace',
      'ws-victim'
    )
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalledWith(
      ATTACKER_USER,
      'workspace',
      'ws-attacker'
    )
  })

  it('denies access when a substring document points at a different key', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: 'ws-attacker', fileUrl: internalUrlFor(`${VICTIM_KEY}-decoy`) },
    ])
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    const granted = await verifyFileAccess(VICTIM_KEY, ATTACKER_USER, undefined, 'knowledge-base')

    expect(granted).toBe(false)
  })

  it('denies access when no document references the key', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const granted = await verifyFileAccess(VICTIM_KEY, ATTACKER_USER, undefined, 'knowledge-base')

    expect(granted).toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('denies when the owning document has no workspace (fail closed)', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: null, fileUrl: internalUrlFor(VICTIM_KEY) },
    ])

    const granted = await verifyFileAccess(VICTIM_KEY, ATTACKER_USER, undefined, 'knowledge-base')

    expect(granted).toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('does not let a later workspace document override a null-workspace owner', async () => {
    // Earliest owner has no workspace; a later attacker-workspace doc must not become owner.
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workspaceId: null, fileUrl: internalUrlFor(VICTIM_KEY) },
      { workspaceId: 'ws-attacker', fileUrl: internalUrlFor(VICTIM_KEY) },
    ])
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    const granted = await verifyFileAccess(VICTIM_KEY, ATTACKER_USER, undefined, 'knowledge-base')

    expect(granted).toBe(false)
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
