import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  archiveSession,
  buildSessionCreatePayload,
  listSessionEvents,
  listSessionEventsPage,
  managedAgentsList,
  parseSessionSnapshot,
  resolvePendingToolGates,
  updateSession,
} from '@/lib/managed-agents/session-client'

const BASE = {
  apiKey: 'sk-ant-fake',
  agentId: 'agent_01ABC',
  environmentId: 'env_01XYZ',
} as const

describe('buildSessionCreatePayload — self-hosted routing', () => {
  it('never sends resources on self-hosted and does not auto-route memory (no native support)', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      environmentType: 'self_hosted',
      memoryStoreId: 'memstore_01',
      memoryAccess: 'read_only',
      memoryInstructions: 'use it',
      files: [{ fileId: 'file_1' }],
      sessionParameters: { SOURCE_TYPE: 'git' },
    })
    expect(payload.resources).toBeUndefined()
    // Only the author's explicit metadata is forwarded — memory is NOT injected.
    expect(payload.metadata).toEqual({ SOURCE_TYPE: 'git' })
  })
})

describe('listSessionEvents — ordering', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('orders events by processed_at ascending, with queued (null) events last', async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        data: [
          { id: 'c', type: 'agent.message', processed_at: '2026-01-01T00:00:03Z' },
          { id: 'a', type: 'agent.message', processed_at: '2026-01-01T00:00:01Z' },
          { id: 'queued', type: 'agent.message', processed_at: null },
          { id: 'b', type: 'agent.message', processed_at: '2026-01-01T00:00:02Z' },
        ],
        next_page: null,
      })
    ) as unknown as typeof fetch

    const events = await listSessionEvents({ apiKey: 'sk-ant-fake', sessionId: 'sess_1' })

    expect(events.map((e) => e.id)).toEqual(['a', 'b', 'c', 'queued'])
  })
})

describe('managedAgentsList — selector collection bounds', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('cancels a non-success response and conceals its provider body', async () => {
    let cancelled = false
    const stream = new ReadableStream({
      cancel() {
        cancelled = true
      },
    })
    global.fetch = vi.fn(
      async () => new Response(stream, { status: 500, statusText: 'provider failure' })
    ) as unknown as typeof fetch

    await expect(managedAgentsList({ apiKey: 'sk-ant-fake', path: '/v1/agents' })).rejects.toThrow(
      'Managed Agents collection request failed'
    )
    expect(cancelled).toBe(true)
  })

  it('cancels a declared oversized collection response before reading it', async () => {
    let cancelled = false
    const stream = new ReadableStream({
      cancel() {
        cancelled = true
      },
    })
    global.fetch = vi.fn(
      async () =>
        new Response(stream, {
          headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
        })
    ) as unknown as typeof fetch

    await expect(managedAgentsList({ apiKey: 'sk-ant-fake', path: '/v1/agents' })).rejects.toThrow(
      'Managed Agents collection response is unavailable'
    )
    expect(cancelled).toBe(true)
  })

  it('enforces the response-byte budget across the whole paginated collection', async () => {
    const firstBody = `${JSON.stringify({ data: [{ id: 'agent-1' }], next_page: 'page-2' })}${' '.repeat(8 * 1024 * 1024)}`
    let secondCancelled = false
    const secondStream = new ReadableStream({
      cancel() {
        secondCancelled = true
      },
    })
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(firstBody))
      .mockResolvedValueOnce(
        new Response(secondStream, {
          headers: { 'content-length': String(9 * 1024 * 1024) },
        })
      ) as unknown as typeof fetch

    await expect(managedAgentsList({ apiKey: 'sk-ant-fake', path: '/v1/agents' })).rejects.toThrow(
      'Managed Agents collection response is unavailable'
    )
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(secondCancelled).toBe(true)
  })

  it('preserves a caller cancellation instead of mapping it to a collection failure', async () => {
    const controller = new AbortController()
    const cancelled = new Error('caller cancelled')
    global.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(cancelled), { once: true })
        })
    ) as unknown as typeof fetch

    const result = managedAgentsList({
      apiKey: 'sk-ant-fake',
      path: '/v1/agents',
      signal: controller.signal,
    })
    controller.abort()

    await expect(result).rejects.toBe(cancelled)
  })
})

describe('parseSessionSnapshot', () => {
  it('reads the blocking event ids off a requires_action stop reason', () => {
    const snapshot = parseSessionSnapshot({
      status: 'idle',
      stop_reason: { type: 'requires_action', event_ids: ['sevt_1', 'sevt_2'] },
    })
    expect(snapshot.stopReason).toEqual({
      type: 'requires_action',
      eventIds: ['sevt_1', 'sevt_2'],
    })
  })

  it('tolerates an unknown status and a missing body', () => {
    expect(parseSessionSnapshot({ status: 'bogus' }).status).toBeUndefined()
    expect(parseSessionSnapshot(null)).toEqual({})
    expect(parseSessionSnapshot(undefined)).toEqual({})
  })
})

describe('session lifecycle calls', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  const captureFetch = (body: unknown = {}) => {
    const spy = vi.fn(async () => Response.json(body)) as unknown as typeof fetch
    global.fetch = spy
    return spy as unknown as ReturnType<typeof vi.fn>
  }

  it('updateSession refuses a no-op update rather than sending an empty body', async () => {
    captureFetch()
    await expect(updateSession({ apiKey: 'sk-ant-fake', sessionId: 'sesn_1' })).rejects.toThrow(
      /requires a title or metadata/
    )
  })

  it('surfaces the status code and body when a call fails', async () => {
    global.fetch = vi.fn(
      async () => new Response('session is running', { status: 400 })
    ) as unknown as typeof fetch
    await expect(archiveSession({ apiKey: 'sk-ant-fake', sessionId: 'sesn_1' })).rejects.toThrow(
      /400.*session is running/
    )
  })
})

describe('resolvePendingToolGates', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves ids to names in the order the API reported them', async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        data: [
          { id: 'sevt_2', type: 'agent.mcp_tool_use', name: 'create_issue', input: { title: 'x' } },
          { id: 'sevt_1', type: 'agent.tool_use', name: 'bash', input: { command: 'ls' } },
        ],
        next_page: null,
      })
    ) as unknown as typeof fetch

    const gates = await resolvePendingToolGates({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      eventIds: ['sevt_1', 'sevt_2'],
    })

    expect(gates).toEqual([
      {
        id: 'sevt_1',
        eventType: 'agent.tool_use',
        kind: 'confirmation',
        name: 'bash',
        input: { command: 'ls' },
      },
      {
        id: 'sevt_2',
        eventType: 'agent.mcp_tool_use',
        kind: 'confirmation',
        name: 'create_issue',
        input: { title: 'x' },
      },
    ])
  })

  it('still returns the ids when enrichment fails — they alone can answer a gate', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const gates = await resolvePendingToolGates({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      eventIds: ['sevt_1', 'sevt_2'],
    })
    expect(gates).toEqual([{ id: 'sevt_1' }, { id: 'sevt_2' }])
  })

  it('labels a custom-tool gate as needing a custom tool result, not a confirmation', async () => {
    // A confirmation cannot unblock a custom tool — the agent is waiting on the
    // tool's actual output — so the kind must route callers to the right op.
    global.fetch = vi.fn(async () =>
      Response.json({
        data: [{ id: 'sevt_9', type: 'agent.custom_tool_use', name: 'lookup_order' }],
        next_page: null,
      })
    ) as unknown as typeof fetch

    const gates = await resolvePendingToolGates({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      eventIds: ['sevt_9'],
    })
    expect(gates[0]?.kind).toBe('custom_tool_result')
  })

  it('finds a gate that lives past the first page', async () => {
    // Gates are the most RECENT tool calls. A read that capped instead of
    // filtering would keep page 1 and miss exactly the events that matter.
    let page = 0
    global.fetch = vi.fn(async () => {
      const offset = page * 100
      page += 1
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: `t${offset + i}`,
        type: 'agent.tool_use',
        name: `tool_${offset + i}`,
      }))
      return Response.json({ data, next_page: page < 4 ? `c${page}` : null })
    }) as unknown as typeof fetch

    const gates = await resolvePendingToolGates({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      eventIds: ['t399'],
    })
    expect(gates).toEqual([
      { id: 't399', eventType: 'agent.tool_use', kind: 'confirmation', name: 'tool_399' },
    ])
  })

  it('keeps paging when an entire page filters out', async () => {
    let page = 0
    const spy = vi.fn(async () => {
      page += 1
      // Page 1 holds nothing wanted; the target is only on page 2.
      const data =
        page === 1
          ? [{ id: 'other', type: 'agent.tool_use', name: 'noise' }]
          : [{ id: 'want', type: 'agent.tool_use', name: 'target' }]
      return Response.json({ data, next_page: page < 2 ? 'c1' : null })
    }) as unknown as typeof fetch
    global.fetch = spy

    const gates = await resolvePendingToolGates({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      eventIds: ['want'],
    })
    expect((spy as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
    expect(gates[0]?.name).toBe('target')
  })

  it('stops paging as soon as every wanted id is found', async () => {
    // The filter keeps `collected` tiny, so no cap can ever trip — without an
    // explicit stop the walk runs to the end of the tool history for nothing.
    let page = 0
    const spy = vi.fn(async () => {
      page += 1
      return Response.json({
        data: [{ id: page === 1 ? 'want' : `other${page}`, type: 'agent.tool_use', name: 'x' }],
        next_page: `c${page}`, // never null: only the stop condition ends this
      })
    }) as unknown as typeof fetch
    global.fetch = spy

    const gates = await resolvePendingToolGates({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      eventIds: ['want'],
    })
    expect(gates).toHaveLength(1)
    expect((spy as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })
})

describe('listSessionEvents — bounded reads', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  /** Emits `pages` pages of 100 chronologically-increasing events. */
  const pagedFetch = (pages: number) => {
    let page = 0
    return vi.fn(async () => {
      const offset = page * 100
      page += 1
      return Response.json({
        data: Array.from({ length: 100 }, (_, i) => ({
          id: `e${offset + i}`,
          type: 'agent.message',
          processed_at: new Date(Date.UTC(2026, 0, 1) + (offset + i) * 1000).toISOString(),
        })),
        next_page: page < pages ? `cursor-${page}` : null,
      })
    }) as unknown as typeof fetch
  }

  it('returns exactly maxItems, never a whole extra page', async () => {
    global.fetch = pagedFetch(3)
    const events = await listSessionEvents({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      maxItems: 250,
    })
    expect(events).toHaveLength(250)
  })

  it('keeps the NEWEST events when capping, not the oldest', async () => {
    // Ascending history: e0 (oldest) .. e249 (newest). A cap of 10 must return
    // the last ten — capping the fetch instead would return e0..e9 and silently
    // drop the agent's most recent reply, which is what callers read this for.
    global.fetch = pagedFetch(3)
    const events = await listSessionEvents({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      maxItems: 10,
    })
    expect(events).toHaveLength(10)
    expect(events[0]?.id).toBe('e290')
    expect(events.at(-1)?.id).toBe('e299')
  })

  it('reports the untrimmed total so a full history is not mistaken for a tail', async () => {
    // A history of exactly `maxItems` dropped nothing — `total === events.length`
    // is what lets the caller tell that apart from a genuinely capped read.
    global.fetch = pagedFetch(3)
    const exact = await listSessionEventsPage({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      maxItems: 300,
    })
    expect(exact.events).toHaveLength(300)
    expect(exact.total).toBe(300)

    global.fetch = pagedFetch(3)
    const capped = await listSessionEventsPage({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      maxItems: 120,
    })
    expect(capped.events).toHaveLength(120)
    expect(capped.total).toBe(300)
  })

  it('never returns the whole history for a zero or negative cap', async () => {
    // `slice(-0)` is `slice(0)` — the entire array — so a zero cap must
    // short-circuit rather than silently become an unbounded read.
    global.fetch = pagedFetch(1)
    const zero = await listSessionEventsPage({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      maxItems: 0,
    })
    expect(zero.events).toHaveLength(0)
    expect(zero.total).toBe(100)

    global.fetch = pagedFetch(1)
    const negative = await listSessionEventsPage({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      maxItems: -5,
    })
    expect(negative.events).toHaveLength(0)
  })

  it.each([0.5, -0.5])(
    'never returns the whole history for the sub-integer cap %p',
    async (maxItems) => {
      // `slice` truncates its index toward zero, so any cap under 1 becomes
      // `slice(-0)` — the entire array — unless it is floored first.
      global.fetch = pagedFetch(1)
      const res = await listSessionEventsPage({
        apiKey: 'sk-ant-fake',
        sessionId: 'sesn_1',
        maxItems,
      })
      expect(res.events).toHaveLength(0)
      expect(res.total).toBe(100)
    }
  )

  it('floors a fractional cap above 1 rather than widening it', async () => {
    global.fetch = pagedFetch(1)
    const res = await listSessionEventsPage({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      maxItems: 10.9,
    })
    expect(res.events).toHaveLength(10)
  })
})
