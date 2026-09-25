import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'
import { ConnectorDirectoryGroupAccessError } from '@/connectors/source-error'
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
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'group-row' }])
  })

  it('rejects group references in a native directory membership', async () => {
    const dir = directory({
      listGroupMembers: vi.fn(async (group) => ({
        group,
        memberTokens: ['g:google-drive:corp.com:engineering'],
        complete: true,
      })),
    })
    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
    ).rejects.toThrow('invalid identity token')
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

  it('stops the tenant walk on a rate limit instead of retrying every remaining group', async () => {
    const quota = Object.assign(new Error('Quota exhausted'), { status: 429, retryAfterMs: 90_000 })
    const dir = directory({ listGroupMembers: vi.fn().mockRejectedValue(quota) })
    await expect(syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })).rejects.toBe(
      quota
    )
    expect(dir.listGroupMembers).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastSyncedAt' in value)).toBe(false)
  })

  it('does not change memberships or directory freshness after losing its lease', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'lease' }]).mockResolvedValueOnce([])
    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: directory() })
    ).rejects.toThrow('Directory sync lease expired or was replaced')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastSyncedAt' in value)).toBe(false)
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastCompleteSyncAt' in value)).toBe(
      false
    )
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
      isSearchIndex: false,
      updatedAt: new Date('2026-09-04T00:00:00Z'),
      lastSyncError: null,
      ...overrides,
    }
  }

  beforeEach(() => {
    resetDbChainMock()
    resetEnvFlagsMock()
    mockResolveTokenUserId.mockResolvedValue('owner-1')
    mockResolveToken.mockResolvedValue({ accessToken: 'token', cloudId: 'cloud-1' })
    mockOpenDirectory.mockResolvedValue(null)
    dbChainMockFns.returning.mockResolvedValue([{ id: 'group-row' }])
  })

  it('skips previously queued Search directory refreshes before resolving credentials in live mode', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow({ isSearchIndex: true })])

    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('skipped')

    expect(mockResolveTokenUserId).not.toHaveBeenCalled()
    expect(mockResolveToken).not.toHaveBeenCalled()
    expect(mockOpenDirectory).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not resolve credentials after source mirroring is disabled', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockAvailability.mockResolvedValueOnce({ sourceMirrored: false, memberScoped: false })
    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('skipped')
    expect(mockResolveTokenUserId).not.toHaveBeenCalled()
    expect(mockOpenDirectory).not.toHaveBeenCalled()
  })

  it('reports a connector whose credential no longer resolves rather than failing', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockResolveTokenUserId.mockResolvedValue(null)

    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('unusable')
    expect(mockOpenDirectory).not.toHaveBeenCalled()
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

  it('keeps unknown failures blocking even when other group memberships refreshed', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockOpenDirectory.mockResolvedValue(
      directory({
        listGroupMembers: vi.fn(async (group) => {
          if (group.id === 'all@corp.com') throw new Error('Connection closed')
          return { group, memberTokens: ['u:alice@corp.com'], complete: true }
        }),
      })
    )
    await expect(refreshConnectorDirectory('connector-1', 'req-1')).rejects.toThrow(
      '1 group memberships could not be refreshed'
    )
  })

  it('keeps a directory with no successful memberships blocking', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockOpenDirectory.mockResolvedValue(
      directory({
        listGroupMembers: vi.fn().mockRejectedValue(
          new ConnectorDirectoryGroupAccessError('External group denied', {
            cause: new GoogleDriveApiError(403, ['forbidden'], 'directory.members.list'),
          })
        ),
      })
    )
    await expect(refreshConnectorDirectory('connector-1', 'req-1')).rejects.toThrow(
      '2 group memberships could not be refreshed'
    )
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastSyncedAt' in value)).toBe(false)
  })
})
