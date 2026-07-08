import { generateShortId } from '@sim/utils/id'
import { describe, expect, it, vi } from 'vitest'
import {
  consumeLatestFileIntent,
  type PendingFileIntent,
  storeFileIntent,
} from './file-intent-store'

// Force the in-memory store path so the test is deterministic and Redis-free.
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => null }))

function makeIntent(overrides: Partial<PendingFileIntent>): PendingFileIntent {
  return {
    operation: 'update',
    fileId: 'file-x',
    workspaceId: 'ws-1',
    userId: 'user-1',
    chatId: 'chat-1',
    messageId: 'msg-1',
    fileRecord: { id: overrides.fileId ?? 'file-x' } as unknown as PendingFileIntent['fileRecord'],
    createdAt: Date.now(),
    ...overrides,
  }
}

function uniqueWorkspace(): string {
  return `ws-${generateShortId()}`
}

describe('file-intent-store channel scoping', () => {
  it('consumes the intent for the requesting channel, not the latest in the message', async () => {
    const ws = uniqueWorkspace()
    const scope = { chatId: 'chat-1', messageId: 'msg-1' }

    // Two concurrent file subagents: A declares fileA on channel F1 first, then
    // B declares fileB on channel F2 (later createdAt = the "latest" in message).
    await storeFileIntent(
      ws,
      'fileA',
      makeIntent({ workspaceId: ws, fileId: 'fileA', channelId: 'F1', createdAt: Date.now() })
    )
    await storeFileIntent(
      ws,
      'fileB',
      makeIntent({
        workspaceId: ws,
        fileId: 'fileB',
        channelId: 'F2',
        createdAt: Date.now() + 1000,
      })
    )

    // edit_content from channel F1 must get fileA — NOT the latest (fileB).
    const a = await consumeLatestFileIntent(ws, { ...scope, channelId: 'F1' })
    expect(a?.fileId).toBe('fileA')

    // edit_content from channel F2 gets fileB.
    const b = await consumeLatestFileIntent(ws, { ...scope, channelId: 'F2' })
    expect(b?.fileId).toBe('fileB')
  })

  it('only consumes its own channel, leaving the sibling intent intact', async () => {
    const ws = uniqueWorkspace()
    const scope = { chatId: 'chat-1', messageId: 'msg-1' }
    await storeFileIntent(
      ws,
      'fileA',
      makeIntent({ workspaceId: ws, fileId: 'fileA', channelId: 'F1', createdAt: Date.now() })
    )
    await storeFileIntent(
      ws,
      'fileB',
      makeIntent({
        workspaceId: ws,
        fileId: 'fileB',
        channelId: 'F2',
        createdAt: Date.now() + 1000,
      })
    )

    await consumeLatestFileIntent(ws, { ...scope, channelId: 'F1' })
    // The sibling (F2) is untouched and still consumable afterward.
    const b = await consumeLatestFileIntent(ws, { ...scope, channelId: 'F2' })
    expect(b?.fileId).toBe('fileB')
  })

  it('falls back to latest-in-message when no channelId (legacy / main-agent)', async () => {
    const ws = uniqueWorkspace()
    const scope = { chatId: 'chat-1', messageId: 'msg-1' }
    await storeFileIntent(
      ws,
      'fileA',
      makeIntent({ workspaceId: ws, fileId: 'fileA', channelId: 'F1', createdAt: Date.now() })
    )
    await storeFileIntent(
      ws,
      'fileB',
      makeIntent({
        workspaceId: ws,
        fileId: 'fileB',
        channelId: 'F2',
        createdAt: Date.now() + 1000,
      })
    )
    const latest = await consumeLatestFileIntent(ws, scope)
    expect(latest?.fileId).toBe('fileB')
  })

  it('returns undefined when the requesting channel has no pending intent', async () => {
    const ws = uniqueWorkspace()
    await storeFileIntent(
      ws,
      'fileA',
      makeIntent({ workspaceId: ws, fileId: 'fileA', channelId: 'F1', createdAt: Date.now() })
    )
    const none = await consumeLatestFileIntent(ws, {
      chatId: 'chat-1',
      messageId: 'msg-1',
      channelId: 'F-absent',
    })
    expect(none).toBeUndefined()
  })
})
