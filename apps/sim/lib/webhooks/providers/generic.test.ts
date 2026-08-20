/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { genericHandler } from '@/lib/webhooks/providers/generic'
import type { FormatInputContext } from '@/lib/webhooks/providers/types'

function context(
  body: unknown,
  query: Record<string, string>,
  options: { headers?: Record<string, string>; secretHeaderName?: string; method?: string } = {}
): FormatInputContext {
  return {
    webhook: {
      id: 'webhook-id',
      provider: 'generic',
      providerConfig: options.secretHeaderName
        ? { secretHeaderName: options.secretHeaderName }
        : {},
    },
    workflow: { id: 'workflow-id', userId: 'user-id' },
    body,
    headers: options.headers ?? {},
    query,
    method: options.method ?? '',
    requestId: 'req-1',
  }
}

describe('genericHandler.formatInput', () => {
  it('exposes query parameters under "query" alongside body fields', async () => {
    const result = await genericHandler.formatInput?.(
      context({ event: 'test' }, { srcId: '123', title: 'Hello' })
    )

    expect(result?.input).toEqual({
      event: 'test',
      query: { srcId: '123', title: 'Hello' },
    })
  })

  it('exposes query parameters when the request has no body', async () => {
    const result = await genericHandler.formatInput?.(context({}, { srcId: '123' }))

    expect(result?.input).toEqual({ query: { srcId: '123' } })
  })

  it('passes the body through unchanged when there are no query parameters', async () => {
    const body = { event: 'test' }
    const result = await genericHandler.formatInput?.(context(body, {}))

    expect(result?.input).toEqual(body)
    expect(result?.input).not.toHaveProperty('query')
  })

  it('keeps a body field named "query" instead of overwriting it', async () => {
    const body = { query: 'user typed this' }
    const result = await genericHandler.formatInput?.(context(body, { srcId: '123' }))

    expect(result?.input).toEqual(body)
  })

  it('leaves non-object bodies untouched', async () => {
    const body = [{ event: 'a' }]
    const result = await genericHandler.formatInput?.(context(body, { srcId: '123' }))

    expect(result?.input).toEqual(body)
  })

  it('exposes request headers under "headers" with lowercased names', async () => {
    const result = await genericHandler.formatInput?.(
      context({ event: 'test' }, {}, { headers: { 'X-Event-Name': 'created' } })
    )

    expect(result?.input).toEqual({
      event: 'test',
      headers: { 'x-event-name': 'created' },
    })
  })

  it('withholds headers that carry credentials', async () => {
    const result = await genericHandler.formatInput?.(
      context(
        {},
        {},
        {
          headers: {
            authorization: 'Bearer secret',
            cookie: 'session=secret',
            'x-api-key': 'secret',
            'x-sim-idempotency-key': 'abc',
            'x-event-name': 'created',
          },
        }
      )
    )

    expect(result?.input).toEqual({ headers: { 'x-event-name': 'created' } })
  })

  it("withholds the webhook's own configured secret header", async () => {
    const result = await genericHandler.formatInput?.(
      context(
        {},
        {},
        {
          headers: { 'X-Secret-Key': 'secret', 'x-event-name': 'created' },
          secretHeaderName: 'X-Secret-Key',
        }
      )
    )

    expect(result?.input).toEqual({ headers: { 'x-event-name': 'created' } })
  })

  it('keeps a body field named "headers" instead of overwriting it', async () => {
    const body = { headers: 'user typed this' }
    const result = await genericHandler.formatInput?.(
      context(body, {}, { headers: { 'x-event-name': 'created' } })
    )

    expect(result?.input).toEqual(body)
  })
})

describe('genericHandler delivery methods', () => {
  it('opts into GET, PUT, PATCH and DELETE deliveries', () => {
    expect(genericHandler.extraDeliveryMethods).toEqual(['GET', 'PUT', 'PATCH', 'DELETE'])
  })

  it('exposes the request method under "method"', async () => {
    const result = await genericHandler.formatInput?.(
      context({ event: 'test' }, {}, { method: 'DELETE' })
    )

    expect(result?.input).toEqual({ event: 'test', method: 'DELETE' })
  })

  it('omits "method" for legacy queued jobs that carry none', async () => {
    const result = await genericHandler.formatInput?.(context({ event: 'test' }, {}))

    expect(result?.input).not.toHaveProperty('method')
  })

  it('keeps a body field named "method" instead of overwriting it', async () => {
    const body = { method: 'user typed this' }
    const result = await genericHandler.formatInput?.(context(body, {}, { method: 'PUT' }))

    expect(result?.input).toEqual(body)
  })
})
