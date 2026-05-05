/**
 * @vitest-environment node
 */

import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

import { CHAT_DISPLAY_NAME_INDEX, suffixedName, trackChatUpload } from './workspace-file-manager'

const CHAT_ID = '11111111-1111-1111-1111-111111111111'
const WORKSPACE_ID = 'ws_1'
const USER_ID = 'user_1'
const S3_KEY = 'mothership/abc/123-image.png'

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

  it('flips an existing workspace-scope row to mothership and returns the displayName', async () => {
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
  })

  it('inserts a new row when no existing key matches', async () => {
    // UPDATE returns no rows — falls through to INSERT.
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
  })

  it('retries with a suffixed displayName on collision against the chat displayName index', async () => {
    // 23505 from the partial unique index on (chat_id, display_name) — the case we retry.
    const displayNameCollision = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: CHAT_DISPLAY_NAME_INDEX,
    })

    // Attempt 1: UPDATE finds no row (returning -> []), then INSERT throws displayName 23505.
    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.values.mockRejectedValueOnce(displayNameCollision)

    // Attempt 2: UPDATE finds no row, INSERT succeeds.
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
  })

  it('does NOT retry on a 23505 from the active-key index (concurrent same-s3Key insert)', async () => {
    // A racing concurrent trackChatUpload for the same s3Key hit INSERT first. Our INSERT
    // 23505s on workspace_files_key_active_unique. Retrying with a suffixed displayName
    // would let the next iteration UPDATE the racer's row and silently rename the path
    // it already returned to its caller — so we throw instead.
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
  })

  it('rethrows non-unique-violation errors immediately', async () => {
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('connection lost'))

    await expect(
      trackChatUpload(WORKSPACE_ID, USER_ID, CHAT_ID, S3_KEY, 'image.png', 'image/png', 1024)
    ).rejects.toThrow('connection lost')
  })
})
