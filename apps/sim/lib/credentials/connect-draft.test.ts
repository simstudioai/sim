/**
 * @vitest-environment node
 */
import { pendingCredentialDraft } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEncryptQuickBooksOAuthClientConfig, mockGenerateId } = vi.hoisted(() => ({
  mockEncryptQuickBooksOAuthClientConfig: vi.fn(),
  mockGenerateId: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({ generateId: mockGenerateId }))
vi.mock('@/lib/oauth/quickbooks-client-config', () => ({
  encryptQuickBooksOAuthClientConfig: mockEncryptQuickBooksOAuthClientConfig,
}))

import { createConnectDraft } from '@/lib/credentials/connect-draft'

describe('createConnectDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGenerateId.mockReturnValue('new-draft-id')
    mockEncryptQuickBooksOAuthClientConfig.mockResolvedValue('encrypted-client-config')
  })

  it('supersedes an active connection intent with a new exact draft id', async () => {
    const expiresAt = new Date('2026-08-13T20:15:00.000Z')
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'new-draft-id', expiresAt }])

    const result = await createConnectDraft({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      displayName: 'Work Gmail',
    })

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-draft-id' })
    )
    const conflict = dbChainMockFns.onConflictDoUpdate.mock.calls[0]?.[0] as
      | { set?: Record<string, unknown>; setWhere?: unknown }
      | undefined
    expect(conflict?.set).toEqual(
      expect.objectContaining({
        id: 'new-draft-id',
        displayName: 'Work Gmail',
        credentialId: null,
      })
    )
    expect(conflict?.setWhere).toBeUndefined()
    expect(result).toEqual({ id: 'new-draft-id', expiresAt })
  })

  it('supersedes a reconnect target when its mutable display name changes', async () => {
    const expiresAt = new Date('2026-08-13T20:15:00.000Z')
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'new-draft-id', expiresAt }])

    await expect(
      createConnectDraft({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        providerId: 'google-email',
        credentialId: 'credential-1',
        displayName: 'Renamed Gmail',
      })
    ).resolves.toEqual({ id: 'new-draft-id', expiresAt })

    expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          id: 'new-draft-id',
          displayName: 'Renamed Gmail',
          credentialId: 'credential-1',
        }),
      })
    )
  })

  it('fails when the draft upsert does not return a row', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(
      createConnectDraft({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        providerId: 'google-email',
        credentialId: 'credential-1',
        displayName: 'Existing Gmail',
      })
    ).rejects.toThrow('Failed to create OAuth credential draft')
  })

  it('encrypts QuickBooks app credentials before storing the draft', async () => {
    const expiresAt = new Date('2026-08-13T20:15:00.000Z')
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'new-draft-id', expiresAt }])
    const oauthClientConfig = {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      environment: 'sandbox' as const,
      webhookVerifierToken: 'verifier-token',
    }

    await createConnectDraft({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      providerId: 'quickbooks',
      displayName: 'QuickBooks Sandbox',
      oauthClientConfig,
    })

    expect(mockEncryptQuickBooksOAuthClientConfig).toHaveBeenCalledWith(oauthClientConfig)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthConfig: 'encrypted-client-config',
      })
    )
    expect(dbChainMockFns.values).not.toHaveBeenCalledWith(
      expect.objectContaining({
        oauthConfig: expect.stringContaining('client-secret'),
      })
    )
  })

  it('requires app credentials for QuickBooks and rejects them for other providers', async () => {
    await expect(
      createConnectDraft({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        providerId: 'quickbooks',
        displayName: 'QuickBooks',
      })
    ).rejects.toThrow(
      'QuickBooks requires an OAuth client ID, client secret, environment, and webhook verifier token'
    )

    await expect(
      createConnectDraft({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        providerId: 'google-email',
        displayName: 'Gmail',
        oauthClientConfig: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          environment: 'production',
          webhookVerifierToken: 'verifier-token',
        },
      })
    ).rejects.toThrow('OAuth client configuration is not supported for provider google-email')
  })
})

describe('organization OAuth draft isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGenerateId.mockReturnValue('new-draft-id')
  })
  it('writes an organization owner and rotates only that organization provider slot', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'new-draft-id', expiresAt: new Date() }])
    await createConnectDraft({
      organizationId: 'org-1',
      userId: 'user-1',
      providerId: 'google-email',
      displayName: 'Org Gmail',
    })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', workspaceId: null })
    )
    const conflict = dbChainMockFns.onConflictDoUpdate.mock.calls[0][0]
    expect(conflict.target).toContain(pendingCredentialDraft.organizationId)
    expect(conflict.target).not.toContain(pendingCredentialDraft.workspaceId)
  })
  it('rejects an ambiguous owner before any write', async () => {
    await expect(
      createConnectDraft({
        organizationId: 'org-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        providerId: 'google-email',
        displayName: 'Ambiguous',
      })
    ).rejects.toThrow()
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })
})
