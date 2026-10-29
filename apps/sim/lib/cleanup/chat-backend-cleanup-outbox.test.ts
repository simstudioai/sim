import { copilotChats } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSweepStoragePrefix, deadline } = vi.hoisted(() => ({
  mockSweepStoragePrefix: vi.fn(),
  deadline: { near: false },
}))

vi.mock('@/lib/uploads/core/prefix-sweep', () => ({
  sweepStoragePrefix: mockSweepStoragePrefix,
  outboxDeadlineNear: () => deadline.near,
}))

import { CHAT_INLINE_IMAGE_CLEANUP_EVENT } from '@/lib/cleanup/chat-backend-cleanup-event'
import { chatBackendCleanupOutboxHandlers } from '@/lib/cleanup/chat-backend-cleanup-outbox'
import type { OutboxEventContext } from '@/lib/core/outbox/service'

const sweepImages = chatBackendCleanupOutboxHandlers[CHAT_INLINE_IMAGE_CLEANUP_EVENT]
const chatIds = Array.from({ length: 25 }, (_, index) => `chat-${String(index).padStart(2, '0')}`)
const prefixOf = (chatId: string) => `chat-images/${chatId}/`

function outboxContext() {
  return {
    eventId: 'event-1',
    eventType: CHAT_INLINE_IMAGE_CLEANUP_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(async (_patch: Record<string, unknown>) => {}),
  } satisfies OutboxEventContext
}

const sweptPrefixes = () => mockSweepStoragePrefix.mock.calls.map(([prefix]) => prefix)

describe('chat inline image cleanup', () => {
  beforeEach(() => {
    resetDbChainMock()
    deadline.near = false
    mockSweepStoragePrefix.mockReset().mockResolvedValue('done')
  })

  it('sweeps several chats at once, never more than ten', async () => {
    queueTableRows(copilotChats, [])
    let inFlight = 0
    let peak = 0
    mockSweepStoragePrefix.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((resolve) => setImmediate(resolve))
      inFlight--
      return 'done'
    })

    await sweepImages({ chatIds }, outboxContext())

    expect(peak).toBe(10)
    expect(new Set(sweptPrefixes())).toEqual(new Set(chatIds.map(prefixOf)))
  })

  it('checkpoints the chats finished before the lowest unfinished one and resumes after them', async () => {
    queueTableRows(copilotChats, [])
    const slow = chatIds[3]
    mockSweepStoragePrefix.mockImplementation(async (prefix: string) => {
      if (prefix !== prefixOf(slow)) return 'done'
      // Finishes after the chats behind it, so only "lowest unfinished" can yield 3 here.
      await new Promise((resolve) => setImmediate(resolve))
      deadline.near = true
      return 'continue'
    })
    const context = outboxContext()

    const result = await sweepImages({ chatIds: chatIds.slice(0, 6) }, context)

    expect(result).toMatchObject({ outcome: 'deferred', consumeAttempt: false })
    expect(context.checkpointPayload).toHaveBeenCalledWith({ swept: 3 })

    queueTableRows(copilotChats, [])
    deadline.near = false
    mockSweepStoragePrefix.mockReset().mockResolvedValue('done')
    await expect(
      sweepImages({ chatIds: chatIds.slice(0, 6), swept: 3 }, outboxContext())
    ).resolves.toBe(undefined)
    expect(sweptPrefixes().sort()).toEqual(chatIds.slice(3, 6).map(prefixOf))
  })

  it('skips a chat id no image key can hold instead of failing the event on every retry', async () => {
    queueTableRows(copilotChats, [])

    await expect(
      sweepImages({ chatIds: ['../escape', chatIds[0]] }, outboxContext())
    ).resolves.toBe(undefined)
    expect(sweptPrefixes()).toEqual([prefixOf(chatIds[0])])
  })

  it('spends an attempt when a chat’s listing stops advancing', async () => {
    queueTableRows(copilotChats, [])
    mockSweepStoragePrefix.mockImplementation(async (prefix: string) =>
      prefix === prefixOf(chatIds[0]) ? 'stalled' : 'done'
    )
    const context = outboxContext()

    const result = await sweepImages({ chatIds: chatIds.slice(0, 2) }, context)

    expect(result).toMatchObject({ outcome: 'deferred' })
    expect(result).not.toMatchObject({ consumeAttempt: false })
    expect(context.checkpointPayload).not.toHaveBeenCalled()
  })

  it('spends an attempt when the lowest unfinished chat stalls, though a later one continues', async () => {
    queueTableRows(copilotChats, [])
    mockSweepStoragePrefix.mockImplementation(async (prefix: string) => {
      if (prefix === prefixOf(chatIds[0])) return 'stalled'
      deadline.near = true
      return 'continue'
    })
    const context = outboxContext()

    const result = await sweepImages({ chatIds: chatIds.slice(0, 2) }, context)

    expect(result).toMatchObject({ outcome: 'deferred' })
    expect(result).not.toMatchObject({ consumeAttempt: false })
    expect(context.checkpointPayload).not.toHaveBeenCalled()
  })
})
