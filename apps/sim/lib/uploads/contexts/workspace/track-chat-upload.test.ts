/**
 * @vitest-environment node
 */

import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckStorageQuotaForBillingContext,
  mockDecrementStorageUsageForBillingContext,
  mockIncrementStorageUsageForBillingContext,
  mockResolveStorageBillingContext,
  mockHasCloudStorage,
  mockHeadObject,
  mockReplaceWorkspaceFileSecretProvenanceInTx,
} = vi.hoisted(() => ({
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockDecrementStorageUsageForBillingContext: vi.fn(),
  mockIncrementStorageUsageForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockHasCloudStorage: vi.fn(),
  mockHeadObject: vi.fn(),
  mockReplaceWorkspaceFileSecretProvenanceInTx: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  decrementStorageUsageForBillingContext: mockDecrementStorageUsageForBillingContext,
  incrementStorageUsageForBillingContext: mockIncrementStorageUsageForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  hasCloudStorage: mockHasCloudStorage,
  headObject: mockHeadObject,
  uploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE: { status: 'exact', entries: [] },
  preserveWorkspaceFileSecretProvenanceInTx: vi.fn(),
  replaceWorkspaceFileSecretProvenanceInTx: mockReplaceWorkspaceFileSecretProvenanceInTx,
}))

import { CHAT_DISPLAY_NAME_INDEX, suffixedName, trackChatUpload } from './workspace-file-manager'

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
  it('returns the original name for n <= 1', () => {
    expect(suffixedName('image.png', 1)).toBe('image.png')
    expect(suffixedName('image.png', 0)).toBe('image.png')
  })

  it('inserts " (n)" before the extension', () => {
    expect(suffixedName('image.png', 2)).toBe('image (2).png')
    expect(suffixedName('image.png', 3)).toBe('image (3).png')
    expect(suffixedName('My File.tar.gz', 2)).toBe('My File.tar (2).gz')
  })

  it('appends " (n)" for extensionless names', () => {
    expect(suffixedName('README', 2)).toBe('README (2)')
    expect(suffixedName('Makefile', 5)).toBe('Makefile (5)')
  })

  it('treats dotfiles as extensionless (leading dot only)', () => {
    expect(suffixedName('.env', 2)).toBe('.env (2)')
    expect(suffixedName('.gitignore', 3)).toBe('.gitignore (3)')
  })

  it('treats trailing-dot names as extensionless', () => {
    expect(suffixedName('weird.', 2)).toBe('weird. (2)')
  })
})

describe('trackChatUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('finalizes a presigned upload without workspace storage accounting', async () => {
    queueOwnershipLookup([])

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
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        key: S3_KEY,
        chatId: CHAT_ID,
        context: 'mothership',
        originalName: 'image.png',
        displayName: 'image.png',
      })
    )
    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).not.toHaveBeenCalled()
    expectNoWorkspaceStorageAccounting()
  })

  it('does not reclassify uploaded bytes while linking chat metadata', async () => {
    queueOwnershipLookup([existingRow()])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'wf_existing', contentUpdatedAt: CONTENT_UPDATED_AT },
    ])
    mockReplaceWorkspaceFileSecretProvenanceInTx.mockRejectedValueOnce(
      new Error('provenance write failed')
    )

    await expect(
      trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
    ).resolves.toEqual({ displayName: 'image.png' })

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mockReplaceWorkspaceFileSecretProvenanceInTx).not.toHaveBeenCalled()
  })

  it('stamps message_id on the UPDATE arm when the birth message is known', async () => {
    queueOwnershipLookup([existingRow()])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'wf_existing', contentUpdatedAt: CONTENT_UPDATED_AT },
    ])

    await trackChatUpload(
      WORKSPACE_ID,
      USER_ID,
      CHAT_ID,
      S3_KEY,
      'image.png',
      'image/png',
      1024,
      'msg_abc'
    )

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: CHAT_ID, messageId: 'msg_abc' })
    )
  })

  it('stamps message_id on the fallback INSERT arm and nulls it when omitted', async () => {
    queueOwnershipLookup([])

    await trackChatUpload(
      WORKSPACE_ID,
      USER_ID,
      CHAT_ID,
      S3_KEY,
      'image.png',
      'image/png',
      1024,
      'msg_abc'
    )

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: CHAT_ID, messageId: 'msg_abc' })
    )

    // Legacy callers without a message id write an explicit NULL ("birth unknown").
    queueOwnershipLookup([existingRow()])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'wf_existing', contentUpdatedAt: CONTENT_UPDATED_AT },
    ])
    await trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageId: null })
    )
  })

  it('retries metadata naming without workspace storage accounting', async () => {
    // 23505 from the partial unique index on (chat_id, display_name) — the case we retry.
    const displayNameCollision = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: CHAT_DISPLAY_NAME_INDEX,
    })

    queueOwnershipLookup([])
    dbChainMockFns.returning.mockRejectedValueOnce(displayNameCollision)

    const result = await trackChatUpload(
      WORKSPACE_ID,
      USER_ID,
      CHAT_ID,
      S3_KEY,
      'image.png',
      'image/png',
      1024
    )

    expect(result).toEqual({ displayName: 'image (2).png' })
    const lastValuesCall =
      dbChainMockFns.values.mock.calls[dbChainMockFns.values.mock.calls.length - 1]
    expect(lastValuesCall[0]).toMatchObject({
      displayName: 'image (2).png',
      originalName: 'image.png',
    })
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

  it('rethrows metadata errors without workspace storage accounting', async () => {
    queueOwnershipLookup([existingRow()])
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('connection lost'))

    await expect(
      trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
    ).rejects.toThrow('connection lost')

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

    it('rejects a key with no workspace prefix at all', async () => {
      await expect(
        trackChatUpload(
          WORKSPACE_ID,
          USER_ID,
          CHAT_ID,
          'mothership/abc/123-image.png',
          'image.png',
          'image/png',
          1024
        )
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

    it('scopes the UPDATE to the caller-owned row id rather than the raw key', async () => {
      queueOwnershipLookup([existingRow({ id: 'wf_mine' })])
      dbChainMockFns.returning.mockResolvedValueOnce([
        { id: 'wf_mine', contentUpdatedAt: CONTENT_UPDATED_AT },
      ])

      await trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)

      expect(dbChainMockFns.where).toHaveBeenCalled()
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: CHAT_ID, context: 'mothership' })
      )
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

    it('still re-links an upload already bound to this same chat', async () => {
      queueOwnershipLookup([existingRow({ chatId: CHAT_ID })])
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
    })

    it('requires the object to exist in storage before minting a new binding', async () => {
      queueOwnershipLookup([])
      mockHeadObject.mockResolvedValueOnce(null)

      await expect(
        trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
      ).rejects.toThrow('not available for a chat attachment')

      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    })

    /**
     * The probe is hygiene, not authorization — a provider 5xx must not drop a
     * legitimate >50MB multipart upload, which is the only path that reaches it.
     * Only a definitive not-found (`null`) rejects.
     */
    it('proceeds when the storage existence probe throws a transient error', async () => {
      queueOwnershipLookup([])
      mockHeadObject.mockRejectedValueOnce(new Error('503 SlowDown'))

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
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({ key: S3_KEY, context: 'mothership' })
      )
    })

    /** Local-storage deployments have no headObject to consult; ownership still gates. */
    it('skips the storage existence probe when cloud storage is not configured', async () => {
      mockHasCloudStorage.mockReturnValue(false)
      queueOwnershipLookup([])

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
      expect(mockHeadObject).not.toHaveBeenCalled()
    })
  })
})
