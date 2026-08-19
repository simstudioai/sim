/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { genericHandler } from '@/lib/webhooks/providers/generic'
import type { FormatInputContext } from '@/lib/webhooks/providers/types'

function context(body: unknown, query: Record<string, string>): FormatInputContext {
  return {
    webhook: { id: 'webhook-id', provider: 'generic' },
    workflow: { id: 'workflow-id', userId: 'user-id' },
    body,
    headers: {},
    query,
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
})

describe('genericHandler delivery methods', () => {
  it('opts into GET deliveries', () => {
    expect(genericHandler.acceptsGetDelivery).toBe(true)
  })
})
