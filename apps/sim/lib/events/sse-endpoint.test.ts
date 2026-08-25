/**
 * @vitest-environment node
 */

import { authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceSSE,
  HEARTBEAT_INTERVAL_MS,
  MAX_CONNECTION_MS,
  MAX_UNDRAINED_CHUNKS,
  ROTATION_GRACE_MS,
} from '@/lib/events/sse-endpoint'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/utils/random', () => ({ randomFloat: () => 0 }))

const PAST_ROTATION_MS = MAX_CONNECTION_MS
const PAST_ROTATION_CLOSE_MS = PAST_ROTATION_MS + ROTATION_GRACE_MS + HEARTBEAT_INTERVAL_MS

/** Enough undrained heartbeats to trip the unread check, and no more. */
const PAST_UNREAD_MS = (MAX_UNDRAINED_CHUNKS + 2) * HEARTBEAT_INTERVAL_MS

async function openConnection(
  signal: AbortSignal = new AbortController().signal,
  subscriptions?: Array<{ subscribe: () => () => void }>
) {
  const unsubscribe = vi.fn()
  const handler = createWorkspaceSSE({
    label: 'test',
    subscriptions: subscriptions ?? [{ subscribe: () => unsubscribe }],
  })
  const request = new NextRequest(new URL('https://sim.test/api/test/events?workspaceId=ws-1'), {
    signal,
  })
  const response = await handler(request)

  return { body: response.body as ReadableStream<Uint8Array>, unsubscribe }
}

/** Resolves once the stream closes. */
async function drain(body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) return
  }
}

async function collect(body: ReadableStream<Uint8Array>, chunks: string[]): Promise<void> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    chunks.push(decoder.decode(value))
  }
}

describe('createWorkspaceSSE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('announces rotation before releasing the old connection', async () => {
    const { body, unsubscribe } = await openConnection()
    const chunks: string[] = []
    const collected = collect(body, chunks)

    await vi.advanceTimersByTimeAsync(PAST_ROTATION_MS)

    expect(chunks).toContain('event: rotate\ndata: {}\n\n')
    expect(unsubscribe).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(ROTATION_GRACE_MS + HEARTBEAT_INTERVAL_MS)

    await collected
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('closes an orphaned connection after the rotation grace period', async () => {
    const { body, unsubscribe } = await openConnection()
    const drained = drain(body)

    await vi.advanceTimersByTimeAsync(PAST_ROTATION_CLOSE_MS)

    await drained
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('releases subscriptions when the consumer stops draining the stream', async () => {
    const { unsubscribe } = await openConnection()

    await vi.advanceTimersByTimeAsync(PAST_UNREAD_MS)

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('keeps a drained connection alive past the unread threshold', async () => {
    const { body, unsubscribe } = await openConnection()
    void drain(body)

    await vi.advanceTimersByTimeAsync(PAST_UNREAD_MS)

    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it('releases subscriptions when the request aborts', async () => {
    const controller = new AbortController()
    const { unsubscribe } = await openConnection(controller.signal)

    controller.abort()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('releases subscriptions when the consumer cancels the stream', async () => {
    const { body, unsubscribe } = await openConnection()

    await body.cancel()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('releases subscriptions once when abort and the ceiling both elapse', async () => {
    const controller = new AbortController()
    const { unsubscribe } = await openConnection(controller.signal)

    controller.abort()
    await vi.advanceTimersByTimeAsync(PAST_ROTATION_CLOSE_MS)

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('runs every teardown when one unsubscribe throws', async () => {
    const first = vi.fn(() => {
      throw new Error('unsubscribe failed')
    })
    const second = vi.fn()
    const controller = new AbortController()
    await openConnection(controller.signal, [
      { subscribe: () => first },
      { subscribe: () => second },
    ])

    controller.abort()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('releases earlier subscriptions when a later subscription fails to initialize', async () => {
    const unsubscribe = vi.fn()
    const handler = createWorkspaceSSE({
      label: 'test',
      subscriptions: [
        { subscribe: () => unsubscribe },
        {
          subscribe: () => {
            throw new Error('subscribe failed')
          },
        },
      ],
    })
    const request = new NextRequest(new URL('https://sim.test/api/test/events?workspaceId=ws-1'))

    const response = await handler(request)

    await expect(response.body?.getReader().read()).rejects.toThrow('subscribe failed')
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
