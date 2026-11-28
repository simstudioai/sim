import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPermissionGroupConfigStore,
  withPermissionGroupScope,
} from '@/lib/permission-groups/request-scope.server'
import type { EventLogEntry, EventLogReadResult } from '@/lib/realtime/event-log'
import { createEventStreamResponse } from '@/lib/realtime/event-stream-route'

interface TestEntry extends EventLogEntry {
  value: string
}

const REVALIDATION_INTERVAL_MS = 30_000

function openStream(revalidateAccess: () => Promise<boolean>) {
  const log: TestEntry[] = []
  const response = createEventStreamResponse<TestEntry>({
    requestId: 'req-1',
    streamId: 'table-1',
    fromEventId: undefined,
    label: 'test',
    getLatestEventId: async () => 0,
    readEventsSince: async (_streamId, after): Promise<EventLogReadResult<TestEntry>> => ({
      status: 'ok',
      events: log.filter((entry) => entry.eventId > after),
    }),
    revalidateAccess,
  })
  const body = response.body
  if (!body) throw new Error('stream response has no body')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let received = ''
  let outcome: 'open' | 'closed' | 'errored' = 'open'
  const drained = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += decoder.decode(value)
      }
      outcome = 'closed'
    } catch {
      outcome = 'errored'
    }
  })()
  return {
    append: (value: string) => log.push({ eventId: log.length + 1, value }),
    received: () => received,
    outcome: () => outcome,
    cancel: async () => {
      await reader.cancel()
      await drained
    },
  }
}

describe('createEventStreamResponse access revalidation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes within one revalidation interval of the caller losing access', async () => {
    let allowed = true
    const stream = openStream(async () => allowed)

    stream.append('before-revocation')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(stream.received()).toContain('before-revocation')

    allowed = false
    await vi.advanceTimersByTimeAsync(REVALIDATION_INTERVAL_MS)
    expect(stream.received()).toContain('event: rotate')
    expect(stream.outcome()).toBe('closed')
  })

  it('fails closed when the access re-check throws', async () => {
    const stream = openStream(async () => {
      throw new Error('db unavailable')
    })

    await vi.advanceTimersByTimeAsync(REVALIDATION_INTERVAL_MS + 1_000)
    expect(stream.outcome()).toBe('errored')
  })

  it('re-resolves permission groups instead of reusing the opening request memo', async () => {
    const storesSeen: unknown[] = []
    let openingStore: unknown
    const stream = withPermissionGroupScope(() => {
      openingStore = getPermissionGroupConfigStore()
      return openStream(async () => {
        storesSeen.push(getPermissionGroupConfigStore())
        return true
      })
    })

    await vi.advanceTimersByTimeAsync(2 * REVALIDATION_INTERVAL_MS + 1_000)

    expect(storesSeen).toHaveLength(2)
    expect(storesSeen).not.toContain(openingStore)
    expect(storesSeen[0]).not.toBe(storesSeen[1])
    await stream.cancel()
  })
})
