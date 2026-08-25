/**
 * @vitest-environment node
 */

import { authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceSSE,
  HEARTBEAT_INTERVAL_MS,
  MAX_CONNECTION_JITTER_MS,
  MAX_CONNECTION_MS,
  MAX_UNDRAINED_CHUNKS,
} from '@/lib/events/sse-endpoint'

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

const PAST_CEILING_MS = MAX_CONNECTION_MS + MAX_CONNECTION_JITTER_MS + HEARTBEAT_INTERVAL_MS

/** Enough undrained heartbeats to trip the unread check, and no more. */
const PAST_UNREAD_MS = (MAX_UNDRAINED_CHUNKS + 2) * HEARTBEAT_INTERVAL_MS

async function openConnection(signal: AbortSignal = new AbortController().signal) {
  const unsubscribe = vi.fn()
  const handler = createWorkspaceSSE({
    label: 'test',
    subscriptions: [{ subscribe: () => unsubscribe }],
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

  it('releases subscriptions and closes the stream when the connection reaches its ceiling', async () => {
    const { body, unsubscribe } = await openConnection()
    const drained = drain(body)

    await vi.advanceTimersByTimeAsync(PAST_CEILING_MS)

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
    await vi.advanceTimersByTimeAsync(PAST_CEILING_MS)

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
