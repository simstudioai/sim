import { describe, expect, it, vi } from 'vitest'
import { DeviceRequestError } from '@/main/desktop-executor/client'
import { InboxDoorbell, parseServerSentEvents } from '@/main/desktop-executor/doorbell'

const encoder = new TextEncoder()

/** A stream the test writes SSE text into, closing when told to or when its reader aborts. */
function controllableStream(signal: AbortSignal) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  signal.addEventListener('abort', () => {
    try {
      controller?.error(new Error('aborted'))
    } catch {}
  })
  return {
    stream,
    write: (text: string) => controller?.enqueue(encoder.encode(text)),
    end: () => controller?.close(),
  }
}

function harness(options: { staleAfterMs?: number; retryBaseMs?: number } = {}) {
  const connections: ReturnType<typeof controllableStream>[] = []
  const failures: DeviceRequestError[] = []
  /** How many times the doorbell rang, and asked to register again. */
  const counts = { rings: 0, unregistered: 0 }
  const onRing = () => {
    counts.rings += 1
  }
  const onUnregistered = () => {
    counts.unregistered += 1
  }
  const doorbell = new InboxDoorbell({
    client: {
      openInboxStream: async (signal) => {
        const failure = failures.shift()
        if (failure) throw failure
        const connection = controllableStream(signal)
        connections.push(connection)
        return connection.stream
      },
    },
    onRing,
    onUnregistered,
    retryBaseMs: 5,
    ...options,
  })
  return { doorbell, connections, failures, counts }
}

describe('parseServerSentEvents', () => {
  it('keeps a partial event for the next chunk and skips comments', () => {
    const { events, rest } = parseServerSentEvents(
      ': heartbeat\n\nevent: inbox_changed\ndata: {"reason":"call"}\n\nevent: rot'
    )
    expect(events).toEqual([{ event: 'inbox_changed', data: '{"reason":"call"}' }])
    expect(rest).toBe('event: rot')
  })
})

describe('InboxDoorbell', () => {
  it('rings on connect and on every inbox change', async () => {
    const { doorbell, connections, counts } = harness()
    doorbell.start()
    await vi.waitFor(() => expect(counts.rings).toBe(1))

    connections[0]?.write('event: inbox_changed\ndata: {"reason":"call"}\n\n')
    await vi.waitFor(() => expect(counts.rings).toBe(2))
    doorbell.stop()
  })

  it('opens a new connection when Sim rotates the stream', async () => {
    const { doorbell, connections } = harness()
    doorbell.start()
    await vi.waitFor(() => expect(connections).toHaveLength(1))

    connections[0]?.write('event: rotate\ndata: {}\n\n')
    await vi.waitFor(() => expect(connections).toHaveLength(2))
    doorbell.stop()
  })

  it('reconnects after the server drops the stream or refuses a connection', async () => {
    const { doorbell, connections, failures, counts } = harness()
    failures.push(new DeviceRequestError(0, 'offline'), new DeviceRequestError(502, 'deploy'))
    doorbell.start()
    await vi.waitFor(() => expect(connections).toHaveLength(1))

    connections[0]?.end()
    await vi.waitFor(() => expect(connections).toHaveLength(2))
    expect(counts.rings).toBe(2)
    doorbell.stop()
  })

  it('backs off when every stream ends as soon as it opens', async () => {
    vi.useFakeTimers()
    const opened: number[] = []
    const doorbell = new InboxDoorbell({
      client: {
        openInboxStream: async () => {
          opened.push(Date.now())
          return new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })
        },
      },
      onRing: () => {},
      onUnregistered: () => {},
      retryBaseMs: 5,
    })
    try {
      doorbell.start()
      await vi.advanceTimersByTimeAsync(400)
      doorbell.stop()
    } finally {
      vi.useRealTimers()
    }

    // A fixed 5 ms retry would open 80; doubling from 5 ms opens a handful.
    expect(opened.length).toBeGreaterThan(2)
    expect(opened.length).toBeLessThan(15)
  })

  it('replaces a connection that goes silent past the heartbeat', async () => {
    const { doorbell, connections } = harness({ staleAfterMs: 30 })
    doorbell.start()

    await vi.waitFor(() => expect(connections.length).toBeGreaterThanOrEqual(2))
    doorbell.stop()
  })

  it('reports a device Sim no longer recognizes', async () => {
    const { doorbell, failures, counts } = harness()
    failures.push(new DeviceRequestError(401, 'unregistered'))
    doorbell.start()

    await vi.waitFor(() => expect(counts.unregistered).toBeGreaterThan(0))
    doorbell.stop()
  })

  it('reconnects at once on wake, without waiting out a backoff', async () => {
    const { doorbell, connections, counts } = harness({ retryBaseMs: 60_000 })
    doorbell.start()
    await vi.waitFor(() => expect(connections).toHaveLength(1))

    doorbell.wake()

    await vi.waitFor(() => expect(connections).toHaveLength(2))
    await vi.waitFor(() => expect(counts.rings).toBe(2))
    doorbell.stop()
  })

  it('starts on wake after sleep stopped it', async () => {
    const { doorbell, connections } = harness({ retryBaseMs: 60_000 })
    doorbell.start()
    await vi.waitFor(() => expect(connections).toHaveLength(1))
    doorbell.stop()

    doorbell.wake()

    await vi.waitFor(() => expect(connections).toHaveLength(2))
    doorbell.stop()
  })
})
