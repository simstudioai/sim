/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  encryptionMock,
  encryptionMockFns,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { getOrCreateOauthRow, loadOauthRow, setOauthRowUser } from './storage'

describe('MCP OAuth storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: '{}' })
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({
      encrypted: 'encrypted',
      iv: 'iv',
    })
  })

  it('loads OAuth state by MCP server, independent of the requesting user', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'oauth-row-1',
        mcpServerId: 'server-1',
        userId: 'authorizer-1',
        workspaceId: 'workspace-1',
        clientInformation: null,
        tokens: null,
        codeVerifier: null,
        state: null,
        updatedAt: new Date(),
      },
    ])

    const row = await loadOauthRow({ mcpServerId: 'server-1' })

    expect(row).toMatchObject({
      id: 'oauth-row-1',
      mcpServerId: 'server-1',
      userId: 'authorizer-1',
      workspaceId: 'workspace-1',
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(1)
  })

  it('reuses the existing workspace OAuth row instead of creating a per-user row', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'oauth-row-1',
        mcpServerId: 'server-1',
        userId: 'authorizer-1',
        workspaceId: 'workspace-1',
        clientInformation: null,
        tokens: null,
        codeVerifier: null,
        state: null,
        updatedAt: new Date(),
      },
    ])

    const row = await getOrCreateOauthRow({
      mcpServerId: 'server-1',
      userId: 'different-user',
      workspaceId: 'workspace-1',
    })

    expect(row.id).toBe('oauth-row-1')
    expect(row.userId).toBe('authorizer-1')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('records the latest authorizing user without changing row ownership', async () => {
    await setOauthRowUser('oauth-row-1', 'user-2')

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        updatedAt: expect.any(Date),
      })
    )
  })
})
