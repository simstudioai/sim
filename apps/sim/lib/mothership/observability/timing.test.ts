import { context, SpanStatusCode, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTracedCliTransport } from '@/lib/mothership/agent-cli/traced-transport'
import {
  traceMothershipQuery,
  traceMothershipTransaction,
} from '@/lib/mothership/observability/database'

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@sim/db', () => ({ db: { transaction } }))

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

  it('does not propagate private trace context to external file URLs', async () => {
    const init = { headers: { accept: 'text/plain' } }
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('external'))
    const url = 'https://storage.test/file?signature=private'
    await createTracedCliTransport('https://sim.test', transport)(url, init)
    expect(transport).toHaveBeenCalledExactlyOnceWith(url, init)
    expect(exporter.getFinishedSpans()).toHaveLength(0)
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
