/** @vitest-environment node */
import { context, SpanStatusCode, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTracedCliTransport } from '@/lib/mothership/agent-cli/traced-transport'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/mothership/generated/trace-events-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import {
  traceMothershipQuery,
  traceMothershipTransaction,
} from '@/lib/mothership/observability/database'

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@sim/db', () => ({ db: { transaction } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Mothership boundary timing', () => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  const manager = new AsyncLocalStorageContextManager()

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider)
    context.setGlobalContextManager(manager.enable())
  })
  beforeEach(() => {
    exporter.reset()
    transaction.mockReset()
  })
  afterAll(async () => {
    context.disable()
    trace.disable()
    await provider.shutdown()
  })

  it('keeps parallel CLI requests under their own tool and propagates the client span', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const headers: Headers[] = []
    const transport: typeof fetch = async (_input, init) => {
      headers.push(new Headers(init?.headers))
      return headers.length === 1 ? first.promise : second.promise
    }
    const fetchCli = createTracedCliTransport('https://sim.test', transport)
    const tracer = trace.getTracer('test')
    const run = (name: string) =>
      tracer.startActiveSpan(name, async (span) => {
        try {
          return await fetchCli(`https://sim.test/api/v2/workflows?secret=${name}`)
        } finally {
          span.end()
        }
      })
    const a = run('tool-a')
    const b = run('tool-b')
    second.resolve(new Response('b'))
    await b
    first.resolve(new Response('a'))
    await a
    const spans = exporter.getFinishedSpans()
    for (const [i, name] of ['tool-a', 'tool-b'].entries()) {
      const parent = spans.find((span) => span.name === name)!
      const child = spans.find(
        (span) => span.parentSpanContext?.spanId === parent.spanContext().spanId
      )!
      expect(child.name).toBe(TraceSpan.CopilotCliHttpHeaders)
      expect(headers[i]?.get('traceparent')).toContain(
        `${child.spanContext().traceId}-${child.spanContext().spanId}`
      )
      expect(child.attributes).toEqual({
        [TraceAttr.HttpMethod]: 'GET',
        [TraceAttr.HttpPath]: '/api/v2/workflows',
        [TraceAttr.HttpStatusCode]: 200,
      })
    }
  })

  it('preserves request options and ends at headers without consuming the response body', async () => {
    const controller = new AbortController()
    const request = new Request('https://sim.test/api/v2/workflows', {
      method: 'POST',
      headers: { 'x-api-key': 'private-key' },
      body: 'payload',
      signal: controller.signal,
    })
    const response = new Response(new ReadableStream())
    const transport: typeof fetch = async (input, init) => {
      expect(input).toBe(request)
      expect(init?.redirect).toBe('manual')
      expect(new Headers(init?.headers).get('x-api-key')).toBe('private-key')
      expect(request.signal.aborted).toBe(false)
      return response
    }
    expect(
      await createTracedCliTransport('https://sim.test', transport)(request, { redirect: 'manual' })
    ).toBe(response)
    expect(response.bodyUsed).toBe(false)
    expect(request.bodyUsed).toBe(false)
    expect(exporter.getFinishedSpans()).toHaveLength(1)
    await response.body?.cancel()
  })

  it('does not propagate private trace context to external file URLs', async () => {
    const init = { headers: { accept: 'text/plain' } }
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('external'))
    const url = 'https://storage.test/file?signature=private'
    await createTracedCliTransport('https://sim.test', transport)(url, init)
    expect(transport).toHaveBeenCalledExactlyOnceWith(url, init)
    expect(exporter.getFinishedSpans()).toHaveLength(0)
  })

  it('keeps HTTP failures and cancellation unchanged without copying exception payloads', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('invalid', { status: 400 }))
    const fetchCli = createTracedCliTransport('https://sim.test', transport)
    expect((await fetchCli('https://sim.test/api/v2/workflows')).status).toBe(400)
    const controller = new AbortController()
    const failure = new Error('sensitive-network-detail')
    controller.abort(failure)
    transport.mockImplementationOnce(async (_input, init) => {
      init?.signal?.throwIfAborted()
      return new Response()
    })
    await expect(
      fetchCli('https://sim.test/api/v2/workflows', { signal: controller.signal })
    ).rejects.toBe(failure)
    for (const span of exporter.getFinishedSpans()) {
      expect(span.status.code).toBe(SpanStatusCode.ERROR)
      expect(span.events).toEqual([])
      expect(JSON.stringify(span.attributes)).not.toContain('sensitive')
    }
  })

  it('separates transaction setup, body and completion without adding database work', async () => {
    const begin = deferred<void>()
    const commit = deferred<void>()
    const bodyDone = deferred<void>()
    const query = vi.fn().mockResolvedValue('result')
    transaction.mockImplementation(async (body) => {
      await begin.promise
      const result = await body({})
      bodyDone.resolve()
      await commit.promise
      return result
    })
    const work = traceMothershipTransaction('test', () =>
      traceMothershipQuery('SELECT', 'api_key', query)
    )
    expect(query).not.toHaveBeenCalled()
    begin.resolve()
    await bodyDone.promise
    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([TraceSpan.CopilotDbQuery])
    commit.resolve()
    expect(await work).toBe('result')
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(1)
    const spans = exporter.getFinishedSpans()
    const transactionSpan = spans.find((span) => span.name === TraceSpan.CopilotDbTransaction)!
    expect(transactionSpan.events.map((event) => event.name)).toEqual([
      TraceEvent.CopilotDbTransactionReady,
      TraceEvent.CopilotDbTransactionBodyComplete,
    ])
    expect(spans[0]?.parentSpanContext?.spanId).toBe(transactionSpan.spanContext().spanId)
  })

  it('keeps database failures intact without recording SQL or bound credential values', async () => {
    const failure = new Error('query failed; bound parameter=private-key')
    transaction.mockImplementation(async (body) => body({}))
    await expect(
      traceMothershipTransaction('delegation', () =>
        traceMothershipQuery('INSERT', 'api_key', () => Promise.reject(failure))
      )
    ).rejects.toBe(failure)
    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(2)
    for (const span of spans) {
      expect(span.status.code).toBe(SpanStatusCode.ERROR)
      expect(
        JSON.stringify({ attributes: span.attributes, events: span.events, status: span.status })
      ).not.toContain('private-key')
    }
  })
})
