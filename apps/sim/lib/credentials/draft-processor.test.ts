import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  deleteWhere: vi.fn(),
  handleCreate: vi.fn(),
  handleReconnect: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mocks.limit,
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: mocks.deleteWhere,
    })),
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    error: mocks.loggerError,
    info: mocks.loggerInfo,
  }),
}))

vi.mock('@/lib/credentials/draft-hooks', () => ({
  handleCreateCredentialFromDraft: mocks.handleCreate,
  handleReconnectCredential: mocks.handleReconnect,
}))

import { processCredentialDraft } from '@/lib/credentials/draft-processor'

const draft = {
  id: 'draft-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  providerId: 'quickbooks',
  displayName: 'QuickBooks',
  description: null,
  credentialId: null,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
}

describe('processCredentialDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when no matching draft exists', async () => {
    mocks.limit.mockResolvedValueOnce([])

    await processCredentialDraft({
      userId: 'user-1',
      providerId: 'quickbooks',
      accountId: 'account-1',
    })

    expect(mocks.limit).toHaveBeenCalledWith(2)
    expect(mocks.handleCreate).not.toHaveBeenCalled()
    expect(mocks.handleReconnect).not.toHaveBeenCalled()
    expect(mocks.deleteWhere).not.toHaveBeenCalled()
  })

  it('creates a credential when exactly one matching draft exists', async () => {
    mocks.limit.mockResolvedValueOnce([draft])

    await processCredentialDraft({
      userId: 'user-1',
      providerId: 'quickbooks',
      accountId: 'account-1',
    })

    expect(mocks.handleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        draft,
        accountId: 'account-1',
        providerId: 'quickbooks',
        userId: 'user-1',
      })
    )
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1)
  })

  it('fails closed instead of binding an account when multiple workspaces have drafts', async () => {
    mocks.limit.mockResolvedValueOnce([
      draft,
      { ...draft, id: 'draft-2', workspaceId: 'workspace-2' },
    ])

    await processCredentialDraft({
      userId: 'user-1',
      providerId: 'quickbooks',
      accountId: 'account-1',
    })

    expect(mocks.handleCreate).not.toHaveBeenCalled()
    expect(mocks.handleReconnect).not.toHaveBeenCalled()
    expect(mocks.deleteWhere).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Refusing to process ambiguous credential drafts',
      expect.objectContaining({ userId: 'user-1', providerId: 'quickbooks', draftCount: 2 })
    )
  })
})
