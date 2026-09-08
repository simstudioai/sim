/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorDirectory } from '@/connectors/types'

const { mockResolveTokenUserId, mockResolveToken, mockOpenDirectory, mockAvailability } =
  vi.hoisted(() => ({
    mockResolveTokenUserId: vi.fn(),
    mockResolveToken: vi.fn(),
    mockOpenDirectory: vi.fn(),
    mockAvailability: vi.fn(async () => ({ sourceMirrored: true, memberScoped: true })),
  }))

vi.mock('@/lib/knowledge/access/availability', () => ({
  resolveKnowledgeAccessAvailability: mockAvailability,
}))
vi.mock('@/lib/knowledge/connectors/access-token', () => ({
  resolveConnectorAccessToken: mockResolveToken,
  resolveConnectorTokenUserId: mockResolveTokenUserId,
  syncContextForToken: (token: { cloudId?: string }) =>
    token.cloudId ? { cloudId: token.cloudId } : {},
}))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    google_drive: {
      id: 'google_drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      openDirectory: mockOpenDirectory,
    },
    notion: { id: 'notion', auth: { mode: 'oauth', provider: 'notion' } },
  },
}))

import {
  refreshConnectorDirectory,
  refreshMirroredDirectory,
  syncExternalDirectoryGroups,
} from '@/lib/knowledge/connectors/external-group-sync'

function directory(overrides: Partial<ConnectorDirectory> = {}): ConnectorDirectory {
  return {
    providerId: 'google-drive',
    tenantId: 'corp.com',
    listGroups: vi.fn(async () => [{ id: 'eng@corp.com' }, { id: 'all@corp.com' }]),
    listGroupMembers: vi.fn(async (group) => ({
      group,
      memberTokens: ['u:alice@corp.com'],
      complete: true,
    })),
    ...overrides,
  }
}

describe('syncExternalDirectoryGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'group-row' }])
  })

  it('skips a directory walked within the sync interval', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    const dir = directory()

    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
    ).resolves.toMatchObject({ skipped: true })
    expect(dir.listGroups).not.toHaveBeenCalled()
  })

  it('refreshes membership during an explicit resync even when the directory was read recently', async () => {
    queueTableRows(schemaMock.knowledgeExternalGroup, [{ id: 'group-row' }])
    const dir = directory()
    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir, force: true })
    ).resolves.toMatchObject({ refreshed: 2, skipped: false })
    expect(dir.listGroupMembers).toHaveBeenCalledTimes(2)
  })

  it('claims the shared directory before enumerating group membership', async () => {
    const dir = directory()
    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
    ).resolves.toMatchObject({ refreshed: 2, skipped: false })
    expect(dir.listGroups).toHaveBeenCalledOnce()
  })

  it('replaces membership only from a complete enumeration, keeping the rest last-known-good', async () => {
    queueTableRows(schemaMock.knowledgeExternalGroup, [])
    const dir = directory({
      listGroupMembers: vi.fn(async (group) =>
        group.id === 'eng@corp.com'
          ? { group, memberTokens: ['u:alice@corp.com'], complete: true }
          : { group, memberTokens: ['u:bob@corp.com'], complete: false }
      ),
    })

    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
    ).resolves.toMatchObject({ refreshed: 1, keptStale: 1, skipped: false })
    expect(dbChainMockFns.set.mock.calls.filter(([value]) => 'lastSyncedAt' in value)).toHaveLength(
      1
    )
  })

  it.each(['ws', 'pub', 'link', 'g:confluence:cloud:group', 'alice@corp.com', 'u:Alice@corp.com'])(
    'rejects invalid member %s before replacing membership or updating freshness',
    async (invalid) => {
      const dir = directory({
        listGroupMembers: vi.fn(async (group) => ({
          group,
          memberTokens: ['s:confluence:-:MixedCase', invalid],
          complete: true,
        })),
      })
      await expect(
        syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
      ).rejects.toThrow('invalid identity token')
      expect(dbChainMockFns.delete).not.toHaveBeenCalled()
      expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastSyncedAt' in value)).toBe(false)
    }
  )

  it('keeps a group whose enumeration threw, without failing the directory', async () => {
    queueTableRows(schemaMock.knowledgeExternalGroup, [])
    const dir = directory({
      listGroupMembers: vi.fn(async (group) => {
        if (group.id === 'all@corp.com') throw new Error('403')
        return { group, memberTokens: ['u:alice@corp.com'], complete: true }
      }),
    })

    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
    ).resolves.toMatchObject({ refreshed: 1, keptStale: 1 })
  })

  it('stops the tenant walk on a rate limit instead of retrying every remaining group', async () => {
    const quota = Object.assign(new Error('Quota exhausted'), { status: 429, retryAfterMs: 90_000 })
    const dir = directory({ listGroupMembers: vi.fn().mockRejectedValue(quota) })
    await expect(syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })).rejects.toBe(
      quota
    )
    expect(dir.listGroupMembers).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastSyncedAt' in value)).toBe(false)
  })

  /**
   * A truncated group listing must not prune: every directory throws rather
   * than returning a partial page, and the sync fails with it.
   */
  it('fails the directory when the group listing itself fails, pruning nothing', async () => {
    queueTableRows(schemaMock.knowledgeExternalGroup, [])
    const dir = directory({ listGroups: vi.fn(async () => Promise.reject(new Error('429'))) })

    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
    ).rejects.toThrow('429')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})

describe('refreshConnectorDirectory', () => {
  function connectorRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'connector-1',
      connectorType: 'google_drive',
      accessMode: 'admin',
      credentialId: 'credential-1',
      encryptedApiKey: null,
      sourceConfig: { adminEmail: 'admin@corp.com' },
      workspaceId: 'ws-1',
      knowledgeBaseOwnerId: 'owner-1',
      updatedAt: new Date('2026-09-04T00:00:00Z'),
      lastSyncError: null,
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveTokenUserId.mockResolvedValue('owner-1')
    mockResolveToken.mockResolvedValue({ accessToken: 'token', cloudId: 'cloud-1' })
    mockOpenDirectory.mockResolvedValue(null)
    dbChainMockFns.returning.mockResolvedValue([{ id: 'group-row' }])
  })

  /**
   * Token reads are scoped to the credential's own account owner, not the
   * knowledge base owner, who is routinely a different member.
   */
  it('resolves the token as the credential owner for an OAuth credential', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockResolveTokenUserId.mockResolvedValue('credential-owner')

    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('skipped')
    expect(mockResolveToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'credential-owner' })
    )
  })

  it('does not resolve credentials after source mirroring is disabled', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockAvailability.mockResolvedValueOnce({ sourceMirrored: false, memberScoped: false })
    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('skipped')
    expect(mockResolveTokenUserId).not.toHaveBeenCalled()
    expect(mockOpenDirectory).not.toHaveBeenCalled()
  })

  it('opens the directory with the site the token already knows', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])

    await refreshConnectorDirectory('connector-1', 'req-1')

    expect(mockOpenDirectory).toHaveBeenCalledWith(
      'token',
      { adminEmail: 'admin@corp.com' },
      { cloudId: 'cloud-1' }
    )
  })

  it('reports a connector whose credential no longer resolves rather than failing', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockResolveTokenUserId.mockResolvedValue(null)

    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('unusable')
    expect(mockOpenDirectory).not.toHaveBeenCalled()
  })

  it('skips a connector whose source has no directory to read', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow({ connectorType: 'notion' })])

    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('skipped')
    expect(mockResolveToken).not.toHaveBeenCalled()
  })

  it('skips a connector that has since left administrator mode', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow({ accessMode: 'workspace' })])

    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('skipped')
  })

  it('propagates a directory failure for worker retries and exposes it on the source', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockOpenDirectory.mockResolvedValue(
      directory({ listGroups: vi.fn().mockRejectedValue(new Error('403')) })
    )
    await expect(refreshConnectorDirectory('connector-1', 'req-1')).rejects.toThrow(
      'Directory refresh failed: 403'
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncError: 'Directory refresh failed: 403',
      })
    )
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('reports partial membership failure without replacing or refreshing that group', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'group-row' }])
    mockOpenDirectory.mockResolvedValue(
      directory({
        listGroupMembers: vi.fn(async (group) => ({ group, memberTokens: [], complete: false })),
      })
    )
    await expect(refreshConnectorDirectory('connector-1', 'req-1')).rejects.toThrow(
      '2 group memberships could not be refreshed'
    )
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastSyncedAt' in value)).toBe(false)
  })

  it('clears a previous directory error after a successful refresh', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      connectorRow({ lastSyncError: 'Directory refresh failed: 403' }),
    ])
    mockOpenDirectory.mockResolvedValue(directory({ listGroups: vi.fn().mockResolvedValue([]) }))
    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('refreshed')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncError: null })
    )
  })

  it('preserves provider retry metadata through the directory failure cause', async () => {
    const { getRetryAfterMs, isRateLimitError } = await import('@/lib/knowledge/documents/utils')
    const providerError = Object.assign(new Error('quota'), { status: 429, retryAfterMs: 60_000 })
    mockOpenDirectory.mockRejectedValue(providerError)
    const failure = await refreshMirroredDirectory({
      workspaceId: 'ws-1',
      connectorConfig: { id: 'google_drive', openDirectory: mockOpenDirectory } as never,
      sourceConfig: {},
      syncContext: {},
      accessToken: 'token',
    }).catch((error: unknown) => error)
    expect(getRetryAfterMs(failure)).toBe(60_000)
    expect(isRateLimitError(failure)).toBe(true)
  })
})
