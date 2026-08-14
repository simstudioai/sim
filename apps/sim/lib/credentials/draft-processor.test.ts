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

import { processCredentialDraft } from '@/lib/credentials/draft-processor'

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
})
