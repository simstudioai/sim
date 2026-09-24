/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'
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
  DIRECTORY_ERROR_PREFIX,
  DIRECTORY_WARNING_PREFIX,
  directorySyncNotice,
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

  /**
   * The reason membership writes are a diff: a directory sync overwhelmingly
   * re-observes membership that has not changed, and rewriting the group would
   * charge two row writes per member to autovacuum for no change at all.
   */
  it('writes nothing when the observed membership already matches', async () => {
    queueTableRows(schemaMock.knowledgeExternalGroup, [])
    queueTableRows(schemaMock.knowledgeExternalGroupMember, [{ subjectToken: 'u:alice@corp.com' }])
    const dir = directory({
      listGroups: vi.fn(async () => [{ id: 'eng@corp.com' }]),
      listGroupMembers: vi.fn(async (group) => ({
        group,
        memberTokens: ['u:alice@corp.com'],
        complete: true,
      })),
    })

    await syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })

    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ subjectToken: 'u:alice@corp.com' })])
    )
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastSyncedAt' in value)).toBe(true)
  })

  /**
   * The removal set is computed from a read, so that read has to be serialized
   * against the other writer. Both callers fence on different leases, and the
   * directory path commits its group upsert in a separate transaction, so the
   * lock has to be taken here.
   */
  it('locks the group row before reading the membership it will diff against', async () => {
    queueTableRows(schemaMock.knowledgeExternalGroup, [])
    queueTableRows(schemaMock.knowledgeExternalGroupMember, [{ subjectToken: 'u:alice@corp.com' }])
    const dir = directory({
      listGroups: vi.fn(async () => [{ id: 'eng@corp.com' }]),
      listGroupMembers: vi.fn(async (group) => ({
        group,
        memberTokens: ['u:alice@corp.com'],
        complete: true,
      })),
    })

    await syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })

    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    const memberReadIndex = dbChainMockFns.from.mock.calls.findIndex(
      ([table]) => table === schemaMock.knowledgeExternalGroupMember
    )
    expect(memberReadIndex).toBeGreaterThanOrEqual(0)
    /**
     * Ordering is the property, not the presence: a lock taken after the read
     * leaves exactly the stale-snapshot race it exists to close.
     */
    expect(dbChainMockFns.for.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.from.mock.invocationCallOrder[memberReadIndex]
    )
  })

  it('writes only the difference when membership changed', async () => {
    queueTableRows(schemaMock.knowledgeExternalGroup, [])
    queueTableRows(schemaMock.knowledgeExternalGroupMember, [
      { subjectToken: 'u:alice@corp.com' },
      { subjectToken: 'u:bob@corp.com' },
    ])
    const dir = directory({
      listGroups: vi.fn(async () => [{ id: 'eng@corp.com' }]),
      listGroupMembers: vi.fn(async (group) => ({
        group,
        memberTokens: ['u:alice@corp.com', 'u:carol@corp.com'],
        complete: true,
      })),
    })

    await syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })

    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      { groupId: expect.any(String), subjectToken: 'u:carol@corp.com' },
    ])
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
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

  it('propagates storage failures without pruning or refreshing memberships', async () => {
    dbChainMockFns.transaction.mockRejectedValueOnce(new Error('Storage write failed'))
    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: directory() })
    ).rejects.toThrow('Storage write failed')
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
    vi.clearAllMocks()
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

  it.each([
    { liveSearch: true, isSearchIndex: false },
    { liveSearch: false, isSearchIndex: true },
  ])('preserves directory refreshes for %j', async ({ liveSearch, isSearchIndex }) => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: liveSearch })
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow({ isSearchIndex })])

    await refreshConnectorDirectory('connector-1', 'req-1')

    expect(mockOpenDirectory).toHaveBeenCalledOnce()
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
      expect.objectContaining({ userId: 'credential-owner', accessMode: 'admin' })
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
        lastSyncError:
          'Directory refresh failed: Directory permission sync failed. Group membership could not be fully verified.',
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

  it('persists the nested Google reason for scheduled directory failures', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    const providerError = new GoogleDriveApiError(403, ['forbidden'], 'directory.members.list')
    mockOpenDirectory.mockResolvedValue(
      directory({ listGroupMembers: vi.fn().mockRejectedValue(providerError) })
    )

    const failure = await refreshConnectorDirectory('connector-1', 'req-1').catch(
      (error: unknown) => error
    )
    expect(getConnectorFailureDiagnostic(failure)).toMatchObject({
      status: 403,
      operation: 'directory.members.list',
      reasons: ['forbidden'],
      phase: 'directory',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncError:
          'Directory refresh failed: Directory permission sync failed (HTTP 403). Operation: directory.members.list. Google reason: forbidden. Group membership could not be fully verified.',
      })
    )
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastSyncedAt' in value)).toBe(false)
  })

  it('reports inaccessible external groups as partial without refreshing their access', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      connectorRow({ lastSyncError: 'Content failed' }),
    ])
    const providerError = new GoogleDriveApiError(403, ['forbidden'], 'directory.members.list')
    mockOpenDirectory.mockResolvedValue(
      directory({
        listGroupMembers: vi.fn(async (group) => {
          if (group.id === 'all@corp.com') {
            throw new ConnectorDirectoryGroupAccessError('External group denied', {
              cause: providerError,
            })
          }
          return { group, memberTokens: ['u:alice@corp.com'], complete: true }
        }),
      })
    )

    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('partial')
    const notice = dbChainMockFns.set.mock.calls.find(([value]) => 'lastSyncError' in value)?.[0]
    expect(notice.lastSyncError).toContain(`${DIRECTORY_WARNING_PREFIX}1 group memberships`)
    expect(notice.lastSyncError).toContain('\nContent failed')
    expect(dbChainMockFns.set.mock.calls.filter(([value]) => 'lastSyncedAt' in value)).toHaveLength(
      1
    )
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastCompleteSyncAt' in value)).toBe(
      false
    )
    /**
     * The accessible group's membership is written; the denied one is left
     * alone. Nothing is deleted because the diff found no member to remove —
     * membership writes are the difference, not a full rewrite.
     */
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      { groupId: expect.any(String), subjectToken: 'u:alice@corp.com' },
    ])
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
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

  it('reports a blocking error when an inaccessible external group failed first', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockOpenDirectory.mockResolvedValue(
      directory({
        listGroupMembers: vi.fn(async (group) => {
          if (group.id === 'eng@corp.com') {
            throw new ConnectorDirectoryGroupAccessError('External group denied', {
              cause: new GoogleDriveApiError(403, ['forbidden'], 'directory.members.list'),
            })
          }
          throw new GoogleDriveApiError(500, ['backendError'], 'directory.members.list')
        }),
      })
    )
    const failure = await refreshConnectorDirectory('connector-1', 'req-1').catch(
      (error: unknown) => error
    )
    expect(getConnectorFailureDiagnostic(failure)).toMatchObject({
      status: 500,
      operation: 'directory.members.list',
      reasons: ['backendError'],
      phase: 'directory',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncError: expect.stringContaining('HTTP 500') })
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

  it('clears only the recovered directory warning while preserving other diagnostics', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      connectorRow({
        lastSyncError: `${DIRECTORY_WARNING_PREFIX}1 group memberships could not be verified\nContent failed`,
      }),
    ])
    mockOpenDirectory.mockResolvedValue(directory({ listGroups: vi.fn().mockResolvedValue([]) }))
    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('refreshed')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncError: 'Content failed' })
    )
  })

  it.each([DIRECTORY_WARNING_PREFIX, DIRECTORY_ERROR_PREFIX])(
    'preserves the previous directory notice when another refresh owns the lease: %s',
    async (prefix) => {
      const warning = `${prefix}1 group memberships could not be verified`
      queueTableRows(schemaMock.knowledgeConnector, [
        connectorRow({ lastSyncError: `${warning}\nContent failed` }),
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([])
      mockOpenDirectory.mockResolvedValue(directory())
      await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('skipped')
      expect(dbChainMockFns.set.mock.calls.some(([value]) => 'lastSyncError' in value)).toBe(false)
      expect(directorySyncNotice(`${warning}\nContent failed`)).toBe(warning)
      expect(directorySyncNotice('Content failed')).toBeNull()
    }
  )

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
    expect(getConnectorFailureDiagnostic(failure)).toMatchObject({
      phase: 'directory',
      status: 429,
      category: 'rate_limit',
    })
    expect(getRetryAfterMs(failure)).toBe(60_000)
    expect(isRateLimitError(failure)).toBe(true)
  })
})
