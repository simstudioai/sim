/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  drizzleOrmMock,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHandleCreateCredentialFromDraft, mockHandleReconnectCredential } = vi.hoisted(() => ({
  mockHandleCreateCredentialFromDraft: vi.fn(),
  mockHandleReconnectCredential: vi.fn(),
}))

vi.mock('@/lib/credentials/draft-hooks', () => ({
  handleCreateCredentialFromDraft: mockHandleCreateCredentialFromDraft,
  handleReconnectCredential: mockHandleReconnectCredential,
}))

import {
  captureOAuthCredentialDraftBinding,
  consumeOAuthCredentialDraftBinding,
  loadOAuthCredentialDraftBinding,
  parseCredentialDraftIdFromCallbackUrl,
  processCredentialDraft,
} from '@/lib/credentials/draft-processor'

function credentialDraft(id: string, workspaceId: string) {
  return {
    id,
    userId: 'user-1',
    workspaceId,
    providerId: 'google-email',
    displayName: 'Work Gmail',
    description: null,
    credentialId: null,
    expiresAt: new Date('2026-08-14T18:15:00.000Z'),
    createdAt: new Date('2026-08-14T18:00:00.000Z'),
  }
}

describe('processCredentialDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('processes only the exact draft bound to the OAuth state', async () => {
    const draft = credentialDraft('draft-2', 'workspace-2')
    queueTableRows(schemaMock.pendingCredentialDraft, [draft])

    await processCredentialDraft({
      draftId: 'draft-2',
      userId: 'user-1',
      providerId: 'google-email',
      accountId: 'account-1',
    })

    expect(drizzleOrmMock.eq).toHaveBeenCalledWith(schemaMock.pendingCredentialDraft.id, 'draft-2')
    expect(mockHandleCreateCredentialFromDraft).toHaveBeenCalledWith({
      draft,
      accountId: 'account-1',
      providerId: 'google-email',
      userId: 'user-1',
      now: expect.any(Date),
    })
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.pendingCredentialDraft)
  })

  it('fails closed when a legacy callback has multiple active drafts', async () => {
    queueTableRows(schemaMock.pendingCredentialDraft, [
      credentialDraft('draft-1', 'workspace-1'),
      credentialDraft('draft-2', 'workspace-2'),
    ])

    await expect(
      processCredentialDraft({
        userId: 'user-1',
        providerId: 'google-email',
        accountId: 'account-1',
      })
    ).rejects.toThrow(
      'Cannot process an ambiguous OAuth credential draft for user user-1 and provider google-email'
    )

    expect(mockHandleCreateCredentialFromDraft).not.toHaveBeenCalled()
    expect(mockHandleReconnectCredential).not.toHaveBeenCalled()
  })

  it('fails when an exact draft is missing or expired', async () => {
    queueTableRows(schemaMock.pendingCredentialDraft, [])

    await expect(
      processCredentialDraft({
        draftId: 'draft-missing',
        userId: 'user-1',
        providerId: 'google-email',
        accountId: 'account-1',
      })
    ).rejects.toThrow(
      'Cannot process missing or expired OAuth credential draft draft-missing for user user-1'
    )

    expect(mockHandleCreateCredentialFromDraft).not.toHaveBeenCalled()
    expect(mockHandleReconnectCredential).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})

describe('parseCredentialDraftIdFromCallbackUrl', () => {
  it('extracts the exact draft id from a valid callback URL', () => {
    expect(
      parseCredentialDraftIdFromCallbackUrl(
        'https://sim.test/oauth/credential-connected?credentialDraftId=draft-1'
      )
    ).toBe('draft-1')
  })

  it('fails closed for malformed or non-string callback state', () => {
    expect(() => parseCredentialDraftIdFromCallbackUrl({})).toThrow(
      'OAuth state callback URL must be a string'
    )
    expect(() => parseCredentialDraftIdFromCallbackUrl('not a URL')).toThrow()
  })
})

describe('loadOAuthCredentialDraftBinding', () => {
  it('returns the exact draft id when OAuth state is readable', async () => {
    await expect(
      loadOAuthCredentialDraftBinding(async () => ({
        callbackURL: 'https://sim.test/oauth/credential-connected?credentialDraftId=draft-exact',
      }))
    ).resolves.toEqual({ status: 'available', draftId: 'draft-exact' })
  })

  it('marks unreadable OAuth state unavailable instead of permitting legacy draft fallback', async () => {
    const stateError = new Error('OAuth state is unavailable')

    await expect(
      loadOAuthCredentialDraftBinding(async () => {
        throw stateError
      })
    ).resolves.toEqual({ status: 'unavailable', error: stateError })
  })

  it('marks malformed callback state unavailable without throwing from the account hook', async () => {
    const binding = await loadOAuthCredentialDraftBinding(async () => ({ callbackURL: null }))

    expect(binding.status).toBe('unavailable')
  })
})

describe('OAuth credential draft account hook binding', () => {
  it('carries an exact binding from the account before-hook to the deferred after-hook', async () => {
    const context = {}

    await captureOAuthCredentialDraftBinding(context, async () => ({
      callbackURL: 'https://sim.test/oauth/credential-connected?credentialDraftId=draft-exact',
    }))

    expect(consumeOAuthCredentialDraftBinding(context)).toEqual({
      status: 'available',
      draftId: 'draft-exact',
    })
    expect(consumeOAuthCredentialDraftBinding(context)).toBeUndefined()
  })

  it('fails before account creation when OAuth state cannot be captured', async () => {
    const context = {}
    const stateError = new Error('OAuth state is unavailable')

    await expect(
      captureOAuthCredentialDraftBinding(context, async () => {
        throw stateError
      })
    ).rejects.toBe(stateError)
    expect(consumeOAuthCredentialDraftBinding(context)).toBeUndefined()
  })
})
