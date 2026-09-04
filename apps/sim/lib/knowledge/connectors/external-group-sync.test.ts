/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorDirectory } from '@/connectors/types'

const { mockResolveTokenUserId, mockResolveToken, mockOpenDirectory } = vi.hoisted(() => ({
  mockResolveTokenUserId: vi.fn(),
  mockResolveToken: vi.fn(),
  mockOpenDirectory: vi.fn(),
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
      memberEmails: ['alice@corp.com'],
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
    queueTableRows(schemaMock.knowledgeExternalGroup, [{ id: 'group-row' }])
    const dir = directory()

    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
    ).resolves.toMatchObject({ skipped: true })
    expect(dir.listGroups).not.toHaveBeenCalled()
  })

  it('replaces membership only from a complete enumeration, keeping the rest last-known-good', async () => {
    queueTableRows(schemaMock.knowledgeExternalGroup, [])
    const dir = directory({
      listGroupMembers: vi.fn(async (group) =>
        group.id === 'eng@corp.com'
          ? { group, memberEmails: ['alice@corp.com'], complete: true }
          : { group, memberEmails: ['bob@corp.com'], complete: false }
      ),
    })

    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
    ).resolves.toMatchObject({ refreshed: 1, keptStale: 1, skipped: false })
    /** One transaction per group whose membership was replaced. */
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
  })

  it('keeps a group whose enumeration threw, without failing the directory', async () => {
    queueTableRows(schemaMock.knowledgeExternalGroup, [])
    const dir = directory({
      listGroupMembers: vi.fn(async (group) => {
        if (group.id === 'all@corp.com') throw new Error('403')
        return { group, memberEmails: ['alice@corp.com'], complete: true }
      }),
    })

    await expect(
      syncExternalDirectoryGroups({ workspaceId: 'ws-1', directory: dir })
    ).resolves.toMatchObject({ refreshed: 1, keptStale: 1 })
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
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveTokenUserId.mockResolvedValue('owner-1')
    mockResolveToken.mockResolvedValue({ accessToken: 'token', cloudId: 'cloud-1' })
    mockOpenDirectory.mockResolvedValue(null)
  })

  /**
   * Token reads are scoped to the credential's own account owner, not the
   * knowledge base owner, who is routinely a different member.
   */
  it('resolves the token as the credential owner for an OAuth credential', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [connectorRow()])
    mockResolveTokenUserId.mockResolvedValue('credential-owner')

    await expect(refreshConnectorDirectory('connector-1', 'req-1')).resolves.toBe('refreshed')
    expect(mockResolveToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'credential-owner' })
    )
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
})
