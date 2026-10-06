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
  const onRing = vi.fn()
  const onUnregistered = vi.fn()
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
  return { doorbell, connections, failures, onRing, onUnregistered }
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
    const { doorbell, connections, onRing } = harness()
    doorbell.start()
    await vi.waitFor(() => expect(onRing).toHaveBeenCalledTimes(1))

    connections[0]?.write('event: inbox_changed\ndata: {"reason":"call"}\n\n')
    await vi.waitFor(() => expect(onRing).toHaveBeenCalledTimes(2))
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
    const { doorbell, connections, failures, onRing } = harness()
    failures.push(new DeviceRequestError(0, 'offline'), new DeviceRequestError(502, 'deploy'))
    doorbell.start()
    await vi.waitFor(() => expect(connections).toHaveLength(1))

    connections[0]?.end()
    await vi.waitFor(() => expect(connections).toHaveLength(2))
    expect(onRing).toHaveBeenCalledTimes(2)
    doorbell.stop()
  })

  it('replaces a connection that goes silent past the heartbeat', async () => {
    const { doorbell, connections } = harness({ staleAfterMs: 30 })
    doorbell.start()

    await vi.waitFor(() => expect(connections.length).toBeGreaterThanOrEqual(2))
    doorbell.stop()
  })

  it('reports a device Sim no longer recognizes', async () => {
    const { doorbell, failures, onUnregistered } = harness()
    failures.push(new DeviceRequestError(401, 'unregistered'))
    doorbell.start()

    await vi.waitFor(() => expect(onUnregistered).toHaveBeenCalled())
    doorbell.stop()
  })

  it('reconnects at once on wake, without waiting out a backoff', async () => {
    const { doorbell, connections, onRing } = harness({ retryBaseMs: 60_000 })
    doorbell.start()
    await vi.waitFor(() => expect(connections).toHaveLength(1))

    doorbell.wake()

    await vi.waitFor(() => expect(connections).toHaveLength(2))
    await vi.waitFor(() => expect(onRing).toHaveBeenCalledTimes(2))
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
