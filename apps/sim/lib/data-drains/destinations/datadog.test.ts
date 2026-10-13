import { gunzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))

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
  vi.stubGlobal('fetch', fetchMock)
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

  it('throws with the entry index when a single entry exceeds 1 MB', async () => {
    const session = datadogDestination.openSession({ config, credentials })
    const huge = 'x'.repeat(500_000)
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
    ).rejects.toThrow(/entry at index 1 is .* exceeds the 1000000-byte per-entry limit/)
    expect(fetchMock).not.toHaveBeenCalled()
    await session.close()
  })

  it.each([
    { count: 6, paddingBytes: 425_000, limit: 'uncompressed bytes' },
    { count: 1001, paddingBytes: 0, limit: 'entry count' },
  ])(
    'splits $limit overflow without losing or reordering entries',
    async ({ count, paddingBytes }) => {
      const rows = Array.from({ length: count }, (_, index) => ({
        id: `event-${index}`,
        detail: 'x'.repeat(paddingBytes),
      }))
      const session = datadogDestination.openSession({ config, credentials })
      try {
        await session.deliver({
          body: Buffer.from(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`),
          contentType: 'application/x-ndjson',
          metadata: { ...meta(0), rowCount: rows.length },
          signal: new AbortController().signal,
        })
        const deliveredIds: string[] = []
        for (const call of fetchMock.mock.calls) {
          const init = call[1] as RequestInit
          const headers = init.headers as Record<string, string>
          const payload =
            headers['Content-Encoding'] === 'gzip'
              ? gunzipSync(init.body as Uint8Array).toString('utf8')
              : (init.body as string)
          expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(5_000_000)
          const entries = JSON.parse(payload) as { id: string }[]
          expect(entries.length).toBeLessThanOrEqual(1000)
          deliveredIds.push(...entries.map((entry) => entry.id))
        }
        expect(deliveredIds).toEqual(rows.map((row) => row.id))
      } finally {
        await session.close()
      }
    }
  )

  it('redacts the configured API key when the provider echoes it in an error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(`Invalid API key: ${credentials.apiKey}`, { status: 403 })
    )
    const session = datadogDestination.openSession({ config, credentials })
    try {
      const result = await session
        .deliver({
          body: Buffer.from('{"id":"event"}\n'),
          contentType: 'application/x-ndjson',
          metadata: meta(0),
          signal: new AbortController().signal,
        })
        .catch((error: unknown) => error)
      expect(result).toBeInstanceOf(Error)
      if (!(result instanceof Error)) throw new Error('Expected delivery to fail')
      expect(result.message).toContain('HTTP 403')
      expect(result.message).not.toContain(credentials.apiKey)
    } finally {
      await session.close()
    }
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
})
