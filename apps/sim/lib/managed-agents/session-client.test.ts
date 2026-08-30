/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  archiveSession,
  buildSessionCreatePayload,
  deleteSession,
  listSessionEvents,
  listSessionEventsPage,
  managedAgentsList,
  parseSessionSnapshot,
  resolvePendingToolGates,
  sendCustomToolResults,
  sendToolConfirmations,
  updateSession,
} from '@/lib/managed-agents/session-client'

const BASE = {
  apiKey: 'sk-ant-fake',
  agentId: 'agent_01ABC',
  environmentId: 'env_01XYZ',
} as const

describe('buildSessionCreatePayload — always-on fields', () => {
  it('emits `agent` and `environment_id` from the input', () => {
    expect(buildSessionCreatePayload({ ...BASE })).toEqual({
      agent: 'agent_01ABC',
      environment_id: 'env_01XYZ',
    })
  })

  it('emits `title` when set', () => {
    expect(buildSessionCreatePayload({ ...BASE, title: 'my session' }).title).toBe('my session')
  })

  it('emits `vault_ids` only when non-empty', () => {
    expect(buildSessionCreatePayload({ ...BASE }).vault_ids).toBeUndefined()
    expect(buildSessionCreatePayload({ ...BASE, vaultIds: [] }).vault_ids).toBeUndefined()
    expect(buildSessionCreatePayload({ ...BASE, vaultIds: ['vlt_1', 'vlt_2'] }).vault_ids).toEqual([
      'vlt_1',
      'vlt_2',
    ])
  })
})

describe('buildSessionCreatePayload — resources', () => {
  it('attaches a memory store as a `memory_store` resource with default access', () => {
    const payload = buildSessionCreatePayload({ ...BASE, memoryStoreId: 'memstore_01' })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
    ])
  })

  it('honors explicit read_only memory access', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
      memoryAccess: 'read_only',
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_only' },
    ])
  })

  it('includes memory instructions when provided', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
      memoryInstructions: 'check before starting',
    })
    expect(payload.resources).toEqual([
      {
        type: 'memory_store',
        memory_store_id: 'memstore_01',
        access: 'read_write',
        instructions: 'check before starting',
      },
    ])
  })

  it('attaches file resources with an optional mount path', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      files: [{ fileId: 'file_1', mountPath: '/data/one' }, { fileId: 'file_2' }],
    })
    expect(payload.resources).toEqual([
      { type: 'file', file_id: 'file_1', mount_path: '/data/one' },
      { type: 'file', file_id: 'file_2' },
    ])
  })

  it('combines memory and file resources in order', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
      files: [{ fileId: 'file_1' }],
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
      { type: 'file', file_id: 'file_1' },
    ])
  })

  it('omits `resources` when nothing is attached', () => {
    expect(buildSessionCreatePayload({ ...BASE }).resources).toBeUndefined()
    expect(buildSessionCreatePayload({ ...BASE, files: [] }).resources).toBeUndefined()
  })
})

describe('buildSessionCreatePayload — metadata', () => {
  it('emits `metadata` from sessionParameters', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      sessionParameters: { foo: 'bar', baz: 'qux' },
    })
    expect(payload.metadata).toEqual({ foo: 'bar', baz: 'qux' })
  })

  it('omits `metadata` when there are no session parameters', () => {
    expect(buildSessionCreatePayload({ ...BASE }).metadata).toBeUndefined()
    expect(buildSessionCreatePayload({ ...BASE, sessionParameters: {} }).metadata).toBeUndefined()
  })

  it('keeps memory on resources and never folds it into metadata (cloud)', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      memoryStoreId: 'memstore_01',
      sessionParameters: { env: 'staging' },
    })
    expect(payload.metadata).toEqual({ env: 'staging' })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
    ])
  })
})

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

  it('sends no metadata on self-hosted when the author set none', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      environmentType: 'self_hosted',
      memoryStoreId: 'memstore_01',
      files: [{ fileId: 'file_1' }],
    })
    expect(payload.resources).toBeUndefined()
    expect(payload.metadata).toBeUndefined()
  })

  it('cloud (default) still attaches memory + files as resources', () => {
    const payload = buildSessionCreatePayload({
      ...BASE,
      environmentType: 'cloud',
      memoryStoreId: 'memstore_01',
      files: [{ fileId: 'file_1' }],
    })
    expect(payload.resources).toEqual([
      { type: 'memory_store', memory_store_id: 'memstore_01', access: 'read_write' },
      { type: 'file', file_id: 'file_1' },
    ])
    expect(payload.metadata).toBeUndefined()
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

describe('buildSessionCreatePayload — initial_events', () => {
  it('seeds a single user.message so create+send is one call', () => {
    const payload = buildSessionCreatePayload({ ...BASE, initialMessage: 'hello there' })
    expect(payload.initial_events).toEqual([
      { type: 'user.message', content: [{ type: 'text', text: 'hello there' }] },
    ])
  })

  it('trims the seeded message', () => {
    const payload = buildSessionCreatePayload({ ...BASE, initialMessage: '  hi  ' })
    expect(payload.initial_events).toEqual([
      { type: 'user.message', content: [{ type: 'text', text: 'hi' }] },
    ])
  })

  it('omits initial_events entirely when there is no message', () => {
    // An empty array is equivalent to omitting the field, and a blank message
    // would be rejected — so neither is ever sent.
    expect(buildSessionCreatePayload({ ...BASE }).initial_events).toBeUndefined()
    expect(
      buildSessionCreatePayload({ ...BASE, initialMessage: '' }).initial_events
    ).toBeUndefined()
    expect(
      buildSessionCreatePayload({ ...BASE, initialMessage: '   ' }).initial_events
    ).toBeUndefined()
  })
})

describe('parseSessionSnapshot', () => {
  it('reads status, usage, title and metadata', () => {
    const snapshot = parseSessionSnapshot({
      status: 'idle',
      title: 'my session',
      metadata: { slack_channel: 'C123', retries: 2, ok: true, dropped: { a: 1 } },
      usage: { input_tokens: 10, output_tokens: 20 },
    })
    expect(snapshot.status).toBe('idle')
    expect(snapshot.title).toBe('my session')
    expect(snapshot.usage).toEqual({ inputTokens: 10, outputTokens: 20 })
    // Scalars are stringified; non-scalars are dropped rather than mangled.
    expect(snapshot.metadata).toEqual({ slack_channel: 'C123', retries: '2', ok: 'true' })
  })

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

  it('updateSession posts title and metadata', async () => {
    const spy = captureFetch({ status: 'idle', title: 'renamed' })
    await updateSession({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      title: 'renamed',
      metadata: { slack_ts: '123' },
    })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/sessions/sesn_1')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'renamed',
      metadata: { slack_ts: '123' },
    })
  })

  it('updateSession refuses a no-op update rather than sending an empty body', async () => {
    captureFetch()
    await expect(updateSession({ apiKey: 'sk-ant-fake', sessionId: 'sesn_1' })).rejects.toThrow(
      /requires a title or metadata/
    )
  })

  it('archiveSession POSTs the archive sub-resource', async () => {
    const spy = captureFetch()
    await archiveSession({ apiKey: 'sk-ant-fake', sessionId: 'sesn_1' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/sessions/sesn_1/archive')
    expect(init.method).toBe('POST')
  })

  it('deleteSession issues a DELETE', async () => {
    const spy = captureFetch()
    await deleteSession({ apiKey: 'sk-ant-fake', sessionId: 'sesn_1' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/sessions/sesn_1')
    expect(init.method).toBe('DELETE')
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

describe('sendToolConfirmations', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  const capture = () => {
    const spy = vi.fn(async () => Response.json({})) as unknown as typeof fetch
    global.fetch = spy
    return spy as unknown as ReturnType<typeof vi.fn>
  }

  it('sends every confirmation in one request', async () => {
    const spy = capture()
    await sendToolConfirmations({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      confirmations: [
        { toolUseId: 'sevt_1', result: 'allow' },
        { toolUseId: 'sevt_2', result: 'allow' },
      ],
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/sessions/sesn_1/events')
    expect(JSON.parse(init.body as string)).toEqual({
      events: [
        { type: 'user.tool_confirmation', tool_use_id: 'sevt_1', result: 'allow' },
        { type: 'user.tool_confirmation', tool_use_id: 'sevt_2', result: 'allow' },
      ],
    })
  })

  it('uses deny_message on a denial and omits it on an allow', async () => {
    const spy = capture()
    await sendToolConfirmations({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      confirmations: [
        { toolUseId: 'sevt_1', result: 'deny', denyMessage: 'not the prod project' },
        { toolUseId: 'sevt_2', result: 'allow', denyMessage: 'ignored' },
      ],
    })
    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).events).toEqual([
      {
        type: 'user.tool_confirmation',
        tool_use_id: 'sevt_1',
        result: 'deny',
        deny_message: 'not the prod project',
      },
      { type: 'user.tool_confirmation', tool_use_id: 'sevt_2', result: 'allow' },
    ])
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

  it('filters the events request to tool-use types', async () => {
    const spy = vi.fn(async () =>
      Response.json({ data: [], next_page: null })
    ) as unknown as typeof fetch
    global.fetch = spy

    await resolvePendingToolGates({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      eventIds: ['sevt_1'],
    })

    const [url] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    const types = new URL(url).searchParams.getAll('types[]')
    expect(types).toEqual(['agent.tool_use', 'agent.mcp_tool_use', 'agent.custom_tool_use'])
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

  it('omits kind when the event could not be resolved', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const gates = await resolvePendingToolGates({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      eventIds: ['sevt_1'],
    })
    expect(gates[0]).toEqual({ id: 'sevt_1' })
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

  it('short-circuits with no ids', async () => {
    const spy = vi.fn() as unknown as typeof fetch
    global.fetch = spy
    expect(
      await resolvePendingToolGates({ apiKey: 'sk-ant-fake', sessionId: 'sesn_1', eventIds: [] })
    ).toEqual([])
    expect(spy).not.toHaveBeenCalled()
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

  it.each([0.5, 0.99, 0, -0.5, -5])(
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

  it('returns the whole history when uncapped', async () => {
    global.fetch = pagedFetch(3)
    const events = await listSessionEvents({ apiKey: 'sk-ant-fake', sessionId: 'sesn_1' })
    expect(events).toHaveLength(300)
  })

  it('passes a types filter through as repeatable types[] params', async () => {
    const spy = vi.fn(async () =>
      Response.json({ data: [], next_page: null })
    ) as unknown as typeof fetch
    global.fetch = spy
    await listSessionEvents({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      types: ['agent.message', ' agent.tool_use '],
    })
    const [url] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(new URL(url).searchParams.getAll('types[]')).toEqual(['agent.message', 'agent.tool_use'])
  })
})

describe('sendCustomToolResults', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sends a user.custom_tool_result per pending call', async () => {
    const spy = vi.fn(async () => Response.json({})) as unknown as typeof fetch
    global.fetch = spy
    await sendCustomToolResults({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      results: [{ customToolUseId: 'sevt_9', content: 'order #42 shipped', isError: false }],
    })
    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(JSON.parse(init.body as string)).toEqual({
      events: [
        {
          type: 'user.custom_tool_result',
          custom_tool_use_id: 'sevt_9',
          content: [{ type: 'text', text: 'order #42 shipped' }],
          is_error: false,
        },
      ],
    })
  })

  it('defaults is_error to false and honors an explicit failure', async () => {
    const spy = vi.fn(async () => Response.json({})) as unknown as typeof fetch
    global.fetch = spy
    await sendCustomToolResults({
      apiKey: 'sk-ant-fake',
      sessionId: 'sesn_1',
      results: [
        { customToolUseId: 'a', content: 'ok' },
        { customToolUseId: 'b', content: 'lookup failed', isError: true },
      ],
    })
    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const events = JSON.parse(init.body as string).events
    expect(events[0].is_error).toBe(false)
    expect(events[1].is_error).toBe(true)
  })
})
