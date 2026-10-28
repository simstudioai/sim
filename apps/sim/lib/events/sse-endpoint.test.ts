import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSSEStream,
  createWorkspaceSSE,
  HEARTBEAT_INTERVAL_MS,
  MAX_CONNECTION_MS,
  MAX_UNDRAINED_CHUNKS,
  OPEN_DEADLINE_MS,
  OPENED_COMMENT,
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
    vi.useFakeTimers()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts the response before the first heartbeat', async () => {
    const { body } = await openConnection()
    const chunks: string[] = []
    void collect(body, chunks)

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS - 1)

    expect(chunks).toEqual([OPENED_COMMENT])
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

  it('never subscribes when the request aborted before the stream started', async () => {
    const controller = new AbortController()
    controller.abort()
    const subscribe = vi.fn(() => () => {})
    const { body } = await openConnection(controller.signal, [{ subscribe }])
    let closed = false
    void drain(body).then(() => {
      closed = true
    })

    await vi.advanceTimersByTimeAsync(0)

    expect(closed).toBe(true)
    expect(subscribe).not.toHaveBeenCalled()
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

describe('createSSEStream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens only once its subscriptions receive events', async () => {
    let live: () => void = () => {}
    const response = createSSEStream(new NextRequest(new URL('https://sim.test/api/test/stream')), {
      label: 'test',
      subscriptions: [
        {
          subscribe: () => () => {},
          ready: () =>
            new Promise<void>((resolve) => {
              live = resolve
            }),
        },
      ],
    })
    const chunks: string[] = []
    void collect(response.body as ReadableStream<Uint8Array>, chunks)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(chunks).toEqual([])

    live()
    await vi.advanceTimersByTimeAsync(0)

    expect(chunks).toEqual([OPENED_COMMENT])
  })

  it('holds events until the stream opens', async () => {
    let live: () => void = () => {}
    let publish: (eventName: string, data: Record<string, unknown>) => void = () => {}
    const response = createSSEStream(new NextRequest(new URL('https://sim.test/api/test/stream')), {
      label: 'test',
      subscriptions: [
        {
          subscribe: (send) => {
            publish = send
            return () => {}
          },
          ready: () =>
            new Promise<void>((resolve) => {
              live = resolve
            }),
        },
      ],
    })
    const chunks: string[] = []
    void collect(response.body as ReadableStream<Uint8Array>, chunks)

    publish('changed', { id: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(chunks).toEqual([])

    live()
    await vi.advanceTimersByTimeAsync(0)
    expect(chunks).toEqual([OPENED_COMMENT, 'event: changed\ndata: {"id":1}\n\n'])
  })

  it('opens at the deadline when a subscription never becomes ready', async () => {
    const response = createSSEStream(new NextRequest(new URL('https://sim.test/api/test/stream')), {
      label: 'test',
      subscriptions: [{ subscribe: () => () => {}, ready: () => new Promise<void>(() => {}) }],
    })
    const chunks: string[] = []
    void collect(response.body as ReadableStream<Uint8Array>, chunks)

    await vi.advanceTimersByTimeAsync(OPEN_DEADLINE_MS - 1)
    expect(chunks).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(chunks).toEqual([OPENED_COMMENT])
  })

  it('writes revalidated events in the order they arrive', async () => {
    let live: () => void = () => {}
    let authorized: () => void = () => {}
    let publish: (eventName: string, data: Record<string, unknown>) => void = () => {}
    const response = createSSEStream(new NextRequest(new URL('https://sim.test/api/test/stream')), {
      label: 'test',
      revalidate: () =>
        new Promise<void>((resolve) => {
          authorized = resolve
        }),
      subscriptions: [
        {
          subscribe: (send) => {
            publish = send
            return () => {}
          },
          ready: () =>
            new Promise<void>((resolve) => {
              live = resolve
            }),
        },
      ],
    })
    const chunks: string[] = []
    void collect(response.body as ReadableStream<Uint8Array>, chunks)

    publish('changed', { n: 1 })
    live()
    await vi.advanceTimersByTimeAsync(0)
    publish('changed', { n: 2 })
    authorized()
    await vi.advanceTimersByTimeAsync(0)

    expect(chunks).toEqual([
      OPENED_COMMENT,
      'event: changed\ndata: {"n":1}\n\n',
      'event: changed\ndata: {"n":2}\n\n',
    ])
  })

  it('writes every event queued before it opened once one authorization passes', async () => {
    let live: () => void = () => {}
    let publish: (eventName: string, data: Record<string, unknown>) => void = () => {}
    const authorizations: Array<() => void> = []
    const response = createSSEStream(new NextRequest(new URL('https://sim.test/api/test/stream')), {
      label: 'test',
      revalidate: () =>
        new Promise<void>((resolve) => {
          authorizations.push(resolve)
        }),
      subscriptions: [
        {
          subscribe: (send) => {
            publish = send
            return () => {}
          },
          ready: () =>
            new Promise<void>((resolve) => {
              live = resolve
            }),
        },
      ],
    })
    const chunks: string[] = []
    void collect(response.body as ReadableStream<Uint8Array>, chunks)
    for (let n = 1; n <= 10; n += 1) publish('changed', { n })
    live()
    await vi.advanceTimersByTimeAsync(0)

    authorizations[0]()
    await vi.advanceTimersByTimeAsync(0)

    expect(chunks).toEqual([
      OPENED_COMMENT,
      ...Array.from({ length: 10 }, (_, index) => `event: changed\ndata: {"n":${index + 1}}\n\n`),
    ])
  })

  it('clears its timers when it closes before it opens', async () => {
    const controller = new AbortController()
    createSSEStream(
      new NextRequest(new URL('https://sim.test/api/test/stream'), { signal: controller.signal }),
      {
        label: 'test',
        subscriptions: [{ subscribe: () => () => {}, ready: () => new Promise<void>(() => {}) }],
      }
    )
    expect(vi.getTimerCount()).toBe(2)

    controller.abort()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('delivers a revalidated event as soon as it is published', async () => {
    let publish: (eventName: string, data: Record<string, unknown>) => void = () => {}
    const response = createSSEStream(new NextRequest(new URL('https://sim.test/api/test/stream')), {
      label: 'test',
      revalidate: async () => {},
      subscriptions: [
        {
          subscribe: (send) => {
            publish = send
            return () => {}
          },
        },
      ],
    })
    const chunks: string[] = []
    void collect(response.body as ReadableStream<Uint8Array>, chunks)
    await vi.advanceTimersByTimeAsync(0)

    publish('inbox_changed', { reason: 'call' })
    await vi.advanceTimersByTimeAsync(0)

    expect(chunks).toEqual([OPENED_COMMENT, 'event: inbox_changed\ndata: {"reason":"call"}\n\n'])
  })
})

describe('createSSEStream retention', () => {
  /** Opens a stream and closes it before it opens; only a weak reference to it escapes. */
  function closedBeforeOpening(ready: Promise<void>): WeakRef<object> {
    const controller = new AbortController()
    const response = createSSEStream(
      new NextRequest(new URL('https://sim.test/api/test/stream'), { signal: controller.signal }),
      { label: 'test', subscriptions: [{ subscribe: () => () => {}, ready: () => ready }] }
    )
    controller.abort()
    return new WeakRef(response.body as object)
  }

  it('does not stay reachable from a subscription that never becomes ready', async () => {
    setFlagsFromString('--expose_gc')
    const collectGarbage = runInNewContext('gc') as () => void
    const neverReady = new Promise<void>(() => {})

    const stream = closedBeforeOpening(neverReady)
    await sleep(0)
    collectGarbage()

    expect(stream.deref()).toBeUndefined()
    expect(neverReady).toBeInstanceOf(Promise)
  })
})
