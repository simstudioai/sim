/**
 * @vitest-environment node
 */
import { gunzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
vi.stubGlobal('fetch', fetchMock)

import { datadogDestination } from '@/lib/data-drains/destinations/datadog'

const config = { site: 'us1' as const, service: 'sim', tags: 'env:prod' }
const credentials = { apiKey: 'dd-key' }

const meta = (sequence: number) => ({
  drainId: 'd1',
  runId: 'r1',
  source: 'workflow_logs' as const,
  sequence,
  rowCount: 2,
  runStartedAt: new Date('2025-06-15T12:00:00Z'),
})

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
})

describe('datadogDestination', () => {
  it('parses NDJSON and POSTs a JSON array of log entries', async () => {
    const session = datadogDestination.openSession({ config, credentials })
    const body = Buffer.from(
      `${JSON.stringify({ id: 'a', name: 'one' })}\n${JSON.stringify({ id: 'b', name: 'two' })}\n`,
      'utf8'
    )
    const result = await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: meta(0),
      signal: new AbortController().signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs')
    const headers = init.headers as Record<string, string>
    expect(headers['DD-API-KEY']).toBe('dd-key')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Accept).toBe('application/json')
    expect(headers['User-Agent']).toBe('sim-data-drain/1.0')
    expect(headers['Content-Encoding']).toBeUndefined()

    const payload = JSON.parse(init.body as string)
    expect(payload).toHaveLength(2)
    expect(payload[0].ddsource).toBe('sim')
    expect(payload[0].service).toBe('sim')
    expect(payload[0].ddtags).toContain('sim_drain_id:d1')
    expect(payload[0].ddtags).toContain('env:prod')
    expect(payload[0].id).toBe('a')
    expect(payload[0].name).toBe('one')
    expect(payload[0].attributes).toBeUndefined()

    expect(result.locator).toMatch(/^datadog:\/\/us1#r1-0/)
    await session.close()
  })

  it('retries 5xx responses then surfaces the final error', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockResolvedValue(new Response('boom', { status: 503 }))
      const session = datadogDestination.openSession({ config, credentials })
      const promise = session.deliver({
        body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
        contentType: 'application/x-ndjson',
        metadata: meta(0),
        signal: new AbortController().signal,
      })
      // Attach a handler so Node doesn't flag the in-flight rejection while
      // we advance fake timers; we still assert via the original promise below.
      const settled = promise.catch((e) => e)
      await vi.runAllTimersAsync()
      await expect(settled).resolves.toMatchObject({ message: expect.stringMatching(/HTTP 503/) })
      expect(fetchMock).toHaveBeenCalledTimes(4)
      await session.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry on non-retryable 4xx (e.g. invalid API key)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
    const session = datadogDestination.openSession({ config, credentials })
    await expect(
      session.deliver({
        body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
        contentType: 'application/x-ndjson',
        metadata: meta(0),
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/HTTP 403/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await session.close()
  })

  it('routes to the EU site host', async () => {
    const session = datadogDestination.openSession({
      config: { ...config, site: 'eu1' },
      credentials,
    })
    await session.deliver({
      body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
      contentType: 'application/x-ndjson',
      metadata: meta(0),
      signal: new AbortController().signal,
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://http-intake.logs.datadoghq.eu/api/v2/logs')
    await session.close()
  })

  it('routes to the AP2 site host', async () => {
    const session = datadogDestination.openSession({
      config: { ...config, site: 'ap2' },
      credentials,
    })
    await session.deliver({
      body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
      contentType: 'application/x-ndjson',
      metadata: meta(0),
      signal: new AbortController().signal,
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://http-intake.logs.ap2.datadoghq.com/api/v2/logs'
    )
    await session.close()
  })

  it('throws with the entry index when a single entry exceeds 1 MB', async () => {
    const session = datadogDestination.openSession({ config, credentials })
    // Two entries; the second exceeds the 1 MB per-entry limit.
    const huge = 'x'.repeat(1024 * 1024 + 10)
    const body = Buffer.from(
      `${JSON.stringify({ id: 'small' })}\n${JSON.stringify({ blob: huge })}\n`,
      'utf8'
    )
    await expect(
      session.deliver({
        body,
        contentType: 'application/x-ndjson',
        metadata: meta(0),
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/entry at index 1 is .* exceeds the 1048576-byte per-entry limit/)
    expect(fetchMock).not.toHaveBeenCalled()
    await session.close()
  })

  it('gzips payloads larger than 1KB and sets Content-Encoding: gzip', async () => {
    const session = datadogDestination.openSession({ config, credentials })
    // Build > 1KB raw payload; padding string is JSON-safe.
    const padding = 'a'.repeat(2048)
    const body = Buffer.from(`${JSON.stringify({ id: 'a', big: padding })}\n`, 'utf8')
    await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: meta(0),
      signal: new AbortController().signal,
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Encoding']).toBe('gzip')
    expect(init.body).toBeInstanceOf(Uint8Array)
    expect(typeof init.body).not.toBe('string')
    const decoded = JSON.parse(gunzipSync(init.body as Uint8Array).toString('utf8'))
    expect(decoded).toHaveLength(1)
    expect(decoded[0].id).toBe('a')
    expect(decoded[0].big).toBe(padding)
    await session.close()
  })

  it('locator includes the dd-request-id header when present', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 202, headers: { 'dd-request-id': 'req-abc-123' } })
    )
    const session = datadogDestination.openSession({ config, credentials })
    const result = await session.deliver({
      body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
      contentType: 'application/x-ndjson',
      metadata: meta(7),
      signal: new AbortController().signal,
    })
    expect(result.locator).toBe('datadog://us1#r1-7@req-abc-123')
    await session.close()
  })
})

describe('datadogDestination test()', () => {
  it('sends a single probe entry', async () => {
    await datadogDestination.test!({
      config,
      credentials,
      signal: new AbortController().signal,
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Accept).toBe('application/json')
    expect(headers['User-Agent']).toBe('sim-data-drain/1.0')
    const payload = JSON.parse(init.body as string)
    expect(payload).toHaveLength(1)
    expect(payload[0].message).toContain('connection test')
  })
})
