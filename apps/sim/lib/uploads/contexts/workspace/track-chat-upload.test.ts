import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { billingStorageMock, billingStorageMockFns } from '@sim/testing/mocks/billing-storage.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/storage', () => billingStorageMock)

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

import { suffixedName, trackChatUpload } from './workspace-file-manager'

const mockReplaceWorkspaceFileSecretProvenanceInTx =
  workspaceFileSecretProvenanceMockFns.mockReplaceWorkspaceFileSecretProvenanceInTx

const mockCheckStorageQuotaForBillingContext =
  billingStorageMockFns.mockCheckStorageQuotaForBillingContext
const mockResolveStorageBillingContext = billingStorageMockFns.mockResolveStorageBillingContext
const mockIncrementStorageUsageForBillingContext =
  billingStorageMockFns.mockIncrementStorageUsageForBillingContextInTx
const mockDecrementStorageUsageForBillingContext =
  billingStorageMockFns.mockDecrementStorageUsageForBillingContextInTx

const mockHasCloudStorage = storageServiceMockFns.mockHasCloudStorage
const mockHeadObject = storageServiceMockFns.mockHeadObject

const CHAT_ID = '11111111-1111-1111-1111-111111111111'
const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222'
const OTHER_WORKSPACE_ID = '33333333-3333-3333-3333-333333333333'
const USER_ID = 'user_1'
const OTHER_USER_ID = 'user_2'
const S3_KEY = `workspace/${WORKSPACE_ID}/1731000000000-ab12cd34-image.png`
const CONTENT_UPDATED_AT = new Date('2026-08-04T00:00:00.000Z')

/** Row shape `resolveClaimableChatUploadRow` selects, with claimable defaults. */
function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf_existing',
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    context: 'mothership',
    chatId: null,
    deletedAt: null,
    ...overrides,
  }
}

/** Queue the key-ownership lookup that runs before every bind. */
function queueOwnershipLookup(rows: unknown[]): void {
  queueTableRows(schemaMock.workspaceFiles, rows)
}

function expectNoWorkspaceStorageAccounting(): void {
  expect(mockCheckStorageQuotaForBillingContext).not.toHaveBeenCalled()
  expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
  expect(mockIncrementStorageUsageForBillingContext).not.toHaveBeenCalled()
  expect(mockDecrementStorageUsageForBillingContext).not.toHaveBeenCalled()
}

describe('suffixedName', () => {
  it('inserts " (n)" before the extension', () => {
    expect(suffixedName('image.png', 2)).toBe('image (2).png')
    expect(suffixedName('image.png', 3)).toBe('image (3).png')
    expect(suffixedName('My File.tar.gz', 2)).toBe('My File.tar (2).gz')
  })

  it('treats dotfiles as extensionless (leading dot only)', () => {
    expect(suffixedName('.env', 2)).toBe('.env (2)')
    expect(suffixedName('.gitignore', 3)).toBe('.gitignore (3)')
  })
})

describe('trackChatUpload', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockHasCloudStorage.mockReturnValue(true)
    mockHeadObject.mockResolvedValue({ size: 1024 })
    dbChainMockFns.returning.mockResolvedValue([
      { id: 'wf_inserted', contentUpdatedAt: CONTENT_UPDATED_AT },
    ])
  })

  it('finalizes an existing direct upload without workspace storage accounting', async () => {
    queueOwnershipLookup([existingRow()])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'wf_existing', contentUpdatedAt: CONTENT_UPDATED_AT },
    ])

    const result = await trackChatUpload(
      WORKSPACE_ID,
      USER_ID,
      CHAT_ID,
      S3_KEY,
      'image.png',
      'image/png',
      1024
    )

    expect(result).toEqual({ displayName: 'image.png' })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID,
        context: 'mothership',
        displayName: 'image.png',
      })
    )
    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).not.toHaveBeenCalled()
    expectNoWorkspaceStorageAccounting()
  })

  it('does not retry an active-key collision', async () => {
    const keyCollision = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'workspace_files_key_active_unique',
    })

    queueOwnershipLookup([])
    dbChainMockFns.returning.mockRejectedValueOnce(keyCollision)

    await expect(
      trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
    ).rejects.toThrow('duplicate key')

    expect(dbChainMockFns.values).toHaveBeenCalledTimes(1)
    expectNoWorkspaceStorageAccounting()
  })

  describe('storage key ownership', () => {
    /**
     * A caller-supplied key that resolves to a different workspace must never
     * reach the binding write — that is cross-tenant key smuggling.
     */
    it('rejects a key addressed to another workspace', async () => {
      const foreignKey = `workspace/${OTHER_WORKSPACE_ID}/1731000000000-ab12cd34-image.png`

      await expect(
        trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, foreignKey, 'image.png', 'image/png', 1024)
      ).rejects.toThrow('not available for a chat attachment')

      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    /**
     * The reported attack: a member hands in another member's workspace-file key
     * and the UPDATE re-parents that row to the caller's chat, hiding it from the
     * workspace Files listing and exposing it to the chat-delete FK cascade.
     */
    it("refuses to re-parent another member's workspace file", async () => {
      queueOwnershipLookup([
        existingRow({ id: 'wf_victim', userId: OTHER_USER_ID, context: 'workspace' }),
      ])

      await expect(
        trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
      ).rejects.toThrow('not available for a chat attachment')

      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    it("refuses to re-parent another member's chat upload", async () => {
      queueOwnershipLookup([existingRow({ id: 'wf_victim', userId: OTHER_USER_ID })])

      await expect(
        trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
      ).rejects.toThrow('not available for a chat attachment')

      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    /** The caller's own workspace file is still a Files-tab file, not a chat upload. */
    it("refuses to convert the caller's own workspace file into a chat upload", async () => {
      queueOwnershipLookup([existingRow({ context: 'workspace' })])

      await expect(
        trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
      ).rejects.toThrow('not available for a chat attachment')

      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    /**
     * The active-key unique index is partial on `deleted_at IS NULL`, so an
     * INSERT over an archived row would succeed and mint a binding granting read
     * access to the archived file's bytes.
     */
    it('refuses to mint a binding over a soft-deleted record for the same key', async () => {
      queueOwnershipLookup([
        existingRow({ id: 'wf_archived', deletedAt: new Date('2026-01-01T00:00:00Z') }),
      ])

      await expect(
        trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
      ).rejects.toThrow('not available for a chat attachment')

      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    /** The row vanished between the ownership check and the write — fail closed. */
    it('fails closed when the owned row disappears before the update lands', async () => {
      queueOwnershipLookup([existingRow({ id: 'wf_mine' })])
      dbChainMockFns.returning.mockResolvedValueOnce([])

      await expect(
        trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
      ).rejects.toThrow('not available for a chat attachment')

      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    /**
     * The ownership lookup and the write are separate statements, so a
     * concurrent `save_upload` can flip the row to context='workspace'
     * in between. The UPDATE must re-assert every ownership predicate rather
     * than matching on the captured row id alone, or it would drag a saved
     * workspace file back into chat scope.
     */
    it('re-asserts every ownership predicate in the update, not just the row id', async () => {
      queueOwnershipLookup([existingRow({ id: 'wf_mine' })])
      dbChainMockFns.returning.mockResolvedValueOnce([
        { id: 'wf_mine', contentUpdatedAt: CONTENT_UPDATED_AT },
      ])

      await trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)

      expect(dbChainMockFns.where.mock.calls.at(-1)?.[0]).toEqual({
        type: 'and',
        conditions: [
          { type: 'eq', left: 'workspaceFiles.id', right: 'wf_mine' },
          { type: 'eq', left: 'workspaceFiles.userId', right: USER_ID },
          { type: 'eq', left: 'workspaceFiles.workspaceId', right: WORKSPACE_ID },
          { type: 'eq', left: 'workspaceFiles.context', right: 'mothership' },
          { type: 'isNull', column: 'workspaceFiles.deletedAt' },
          {
            type: 'or',
            conditions: [
              { type: 'isNull', column: 'workspaceFiles.chatId' },
              { type: 'eq', left: 'workspaceFiles.chatId', right: CHAT_ID },
            ],
          },
        ],
      })
    })

    /**
     * An upload binds to exactly one chat. Matches the 409 the sibling
     * `local-files/stage` route already returns for this case.
     */
    it('refuses to relink an upload already bound to a different chat', async () => {
      queueOwnershipLookup([existingRow({ chatId: 'other-chat-id' })])

      await expect(
        trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
      ).rejects.toThrow('not available for a chat attachment')

      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    it('requires the object to exist in storage before minting a new binding', async () => {
      queueOwnershipLookup([])
      mockHeadObject.mockResolvedValueOnce(null)

      await expect(
        trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
      ).rejects.toThrow('not available for a chat attachment')

      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })
  })
})
