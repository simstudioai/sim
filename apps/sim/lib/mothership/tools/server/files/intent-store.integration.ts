/**
 * The file intent store against a real Redis: prepare_file_edit stages an intent that its paired
 * apply_file_edit must consume, even when sibling file subagents in the same message stage theirs
 * concurrently. Failure modes:
 * - a concurrent sibling's later intent is consumed by the wrong subagent
 * - consuming one channel's intent removes its sibling's
 * - a caller with no channel cannot reach the message's latest intent
 * - an intent older than its TTL is still handed out, and lingers in the hash
 * - apply_file_edit arrives before its prepare and fails instead of waiting
 * - the wait outlives its deadline when no prepare ever lands
 * Each test uses a fresh workspace id; the integration setup flushes Redis per file.
 */
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { afterAll, describe, expect, it } from 'vitest'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import {
  consumeLatestFileIntent,
  type PendingFileIntent,
  storeFileIntent,
  waitForLatestFileIntent,
} from '@/lib/mothership/tools/server/files/intent-store'

afterAll(async () => {
  await closeRedisConnection()
})

function makeIntent(overrides: Partial<PendingFileIntent>): PendingFileIntent {
  return {
    operation: 'update',
    fileId: 'file-x',
    workspaceId: 'ws-1',
    userId: 'user-1',
    chatId: 'chat-1',
    messageId: 'msg-1',
    fileRecord: {
      id: overrides.fileId ?? 'file-x',
      workspaceId: 'ws-1',
      name: 'notes.md',
      key: 'workspace/ws-1/notes.md',
      path: '/api/files/serve/workspace/ws-1/notes.md',
      size: 0,
      type: 'text/markdown',
      uploadedBy: 'user-1',
      uploadedAt: new Date(0),
      updatedAt: new Date(0),
    },
    createdAt: Date.now(),
    ...overrides,
  }
}

function uniqueWorkspace(): string {
  return `ws-${generateShortId()}`
}

describe('file intent store channel scoping', () => {
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

    // apply_file_edit from channel F1 must get fileA — NOT the latest (fileB).
    const a = await consumeLatestFileIntent(ws, { ...scope, channelId: 'F1' })
    expect(a?.fileId).toBe('fileA')

    // apply_file_edit from channel F2 gets fileB.
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

  it('never hands out an intent older than its TTL, and removes it from the hash', async () => {
    const ws = uniqueWorkspace()
    const scope = { chatId: 'chat-1', messageId: 'msg-1', channelId: 'F1' }
    await storeFileIntent(
      ws,
      'fileA',
      makeIntent({
        workspaceId: ws,
        fileId: 'fileA',
        channelId: 'F1',
        createdAt: Date.now() - 2 * 60 * 60 * 1000,
      })
    )

    expect(await consumeLatestFileIntent(ws, scope)).toBeUndefined()
    expect(await getRedisClient().hlen(`mothership_file_intent:${ws}`)).toBe(0)
  })
})

describe('waitForLatestFileIntent', () => {
  // The model can batch prepare_file_edit + apply_file_edit into one round, and
  // same-round tools execute concurrently — apply must tolerate its prepare
  // landing a beat later instead of failing the pair.
  it('picks up an intent staged after the wait began', async () => {
    const ws = uniqueWorkspace()
    const scope = { chatId: 'chat-1', messageId: 'msg-1', channelId: 'F1' }
    const pending = waitForLatestFileIntent(ws, scope, { timeoutMs: 500, intervalMs: 10 })
    await sleep(30)
    await storeFileIntent(
      ws,
      'fileA',
      makeIntent({ workspaceId: ws, fileId: 'fileA', channelId: 'F1', createdAt: Date.now() })
    )
    const intent = await pending
    expect(intent?.fileId).toBe('fileA')
  })

  it('returns undefined once the deadline passes with no intent staged', async () => {
    const ws = uniqueWorkspace()
    const none = await waitForLatestFileIntent(
      ws,
      { chatId: 'chat-1', messageId: 'msg-1', channelId: 'F1' },
      { timeoutMs: 40, intervalMs: 10 }
    )
    expect(none).toBeUndefined()
  })
})
