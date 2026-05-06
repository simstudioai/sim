import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGo } from '@/lib/copilot/request/go/fetch'

describe('fetchGo', () => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })

  beforeEach(() => {
    exporter.reset()
    trace.setGlobalTracerProvider(provider)
    vi.restoreAllMocks()
  })

  it('emits a client span with http.* attrs and injects traceparent', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/)
      return new Response('ok', {
        status: 200,
        headers: { 'content-length': '2' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchGo('https://backend.example.com/api/copilot', {
      method: 'POST',
      body: 'payload',
      operation: 'stream',
      attributes: { 'copilot.leg': 'sim_to_go' },
    })
    expect(res.status).toBe(200)

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    const attrs = spans[0].attributes
    expect(spans[0].name).toBe('sim → go /api/copilot')
    expect(attrs['http.method']).toBe('POST')
    expect(attrs['http.url']).toBe('https://backend.example.com/api/copilot')
    expect(attrs['http.target']).toBe('/api/copilot')
    expect(attrs['http.status_code']).toBe(200)
    expect(attrs['copilot.operation']).toBe('stream')
    expect(attrs['copilot.leg']).toBe('sim_to_go')
    expect(typeof attrs['http.response.headers_ms']).toBe('number')
  })

  it('marks span as error on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))

    const res = await fetchGo('https://backend.example.com/api/tools/resume', {
      method: 'POST',
    })
    expect(res.status).toBe(500)

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0].status.code).toBe(2)
  })

  it('records exceptions when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network boom')))

    await expect(
      fetchGo('https://backend.example.com/api/traces', { method: 'POST' })
    ).rejects.toThrow('network boom')

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0].status.code).toBe(2)
    expect(spans[0].events.some((e) => e.name === 'exception')).toBe(true)
  })
})
