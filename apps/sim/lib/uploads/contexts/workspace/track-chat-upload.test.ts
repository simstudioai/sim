/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckStorageQuotaForBillingContext,
  mockDecrementStorageUsageForBillingContext,
  mockIncrementStorageUsageForBillingContext,
  mockResolveStorageBillingContext,
} = vi.hoisted(() => ({
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockDecrementStorageUsageForBillingContext: vi.fn(),
  mockIncrementStorageUsageForBillingContext: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuotaForBillingContext: mockCheckStorageQuotaForBillingContext,
  decrementStorageUsageForBillingContext: mockDecrementStorageUsageForBillingContext,
  incrementStorageUsageForBillingContext: mockIncrementStorageUsageForBillingContext,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))

import { CHAT_DISPLAY_NAME_INDEX, suffixedName, trackChatUpload } from './workspace-file-manager'

const CHAT_ID = '11111111-1111-1111-1111-111111111111'
const WORKSPACE_ID = 'ws_1'
const USER_ID = 'user_1'
const S3_KEY = 'mothership/abc/123-image.png'

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
  })

  it('finalizes an existing direct upload without workspace storage accounting', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'wf_existing' }])

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
    expectNoWorkspaceStorageAccounting()
  })

  it('finalizes a presigned upload without workspace storage accounting', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])

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
    expectNoWorkspaceStorageAccounting()
  })

  it('stamps message_id on the UPDATE arm when the birth message is known', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'wf_existing' }])

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
    dbChainMockFns.returning.mockResolvedValueOnce([])

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
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'wf_existing' }])
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

    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.values.mockRejectedValueOnce(displayNameCollision)
    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.values.mockResolvedValueOnce(undefined)

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

    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.values.mockRejectedValueOnce(keyCollision)

    await expect(
      trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
    ).rejects.toThrow('duplicate key')

    expect(dbChainMockFns.values).toHaveBeenCalledTimes(1)
    expectNoWorkspaceStorageAccounting()
  })

  it('rethrows metadata errors without workspace storage accounting', async () => {
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('connection lost'))

    await expect(
      trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
    ).rejects.toThrow('connection lost')

    expectNoWorkspaceStorageAccounting()
  })
})
