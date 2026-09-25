import { describe, expect, it } from 'vitest'
import { genericHandler } from '@/lib/webhooks/providers/generic'
import type { FormatInputContext } from '@/lib/webhooks/providers/types'

interface ContextOptions {
  headers?: Record<string, string>
  secretHeaderName?: string
  token?: string
  method?: string
  /** `acceptOtherMethods` — gates the `method` key and the non-POST route methods. */
  acceptOtherMethods?: boolean
  /** `exposeRequestHeaders` — gates the `headers` key. */
  exposeRequestHeaders?: boolean
}

function context(
  body: unknown,
  query: Record<string, string>,
  options: ContextOptions = {}
): FormatInputContext {
  return {
    webhook: {
      id: 'webhook-id',
      provider: 'generic',
      providerConfig: {
        ...(options.secretHeaderName ? { secretHeaderName: options.secretHeaderName } : {}),
        ...(options.token ? { token: options.token } : {}),
        ...(options.acceptOtherMethods ? { acceptOtherMethods: true } : {}),
        ...(options.exposeRequestHeaders ? { exposeRequestHeaders: true } : {}),
      },
    },
    workflow: { id: 'workflow-id', userId: 'user-id' },
    body,
    headers: options.headers ?? {},
    query,
    method: options.method ?? 'POST',
    requestId: 'req-1',
  }
}

const format = (...args: Parameters<typeof context>) =>
  genericHandler.formatInput!(context(...args))

describe('genericHandler.formatInput defaults', () => {
  it('withholds "method" until the webhook accepts more than POST', async () => {
    const result = await format({ event: 'test' }, {}, { method: 'POST' })

    expect(result.input).not.toHaveProperty('method')
  })

  it('withholds "headers" until the webhook opts in', async () => {
    const result = await format({}, {}, { headers: { 'x-event-name': 'created' } })

    expect(result.input).not.toHaveProperty('headers')
  })
})

describe('genericHandler.formatInput body precedence', () => {
  it.each([
    ['query', { query: 'user typed this' }, { srcId: '123' }, {}],
    ['headers', { headers: 'user typed this' }, {}, { exposeRequestHeaders: true }],
    ['method', { method: 'user typed this' }, {}, { acceptOtherMethods: true, method: 'PUT' }],
  ])('keeps a body field named "%s" instead of overwriting it', async (_key, body, query, opts) => {
    const result = await format(body, query, {
      ...(opts as ContextOptions),
      headers: { 'x-event-name': 'created' },
    })

    expect(result.input).toEqual(body)
  })

  /**
   * `Object.hasOwn`, not `in` — otherwise an inherited key would read as a collision and the
   * metadata would silently vanish.
   */
  it('does not treat an inherited property name as a body field', async () => {
    const body = Object.create({ query: 'from the prototype' })
    body.event = 'test'

    const result = await format(body, { srcId: '123' })

    expect(result.input).toMatchObject({ event: 'test', query: { srcId: '123' } })
  })
})

describe('genericHandler.formatInput exposed headers', () => {
  const withHeaders = (headers: Record<string, string>, options: ContextOptions = {}) =>
    format({}, {}, { ...options, headers, exposeRequestHeaders: true })

  it.each([
    'authorization',
    'authentication',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'api-key',
    'apikey',
    'x-api-key',
    'x-api-token',
    'x-auth-token',
    'x-auth-key',
    'x-access-token',
    'x-secret-key',
    'x-functions-key',
    'x-amz-security-token',
    'x-goog-api-key',
    'x-csrf-token',
    'x-sim-idempotency-key',
  ])('withholds the credential header %s', async (name) => {
    const result = await withHeaders({ [name]: 'secret', 'x-event-name': 'created' })

    expect(result.input).toEqual({ headers: { 'x-event-name': 'created' } })
  })

  it("withholds the webhook's own configured secret header", async () => {
    const result = await withHeaders(
      { 'X-Secret-Key': 'secret', 'x-event-name': 'created' },
      { secretHeaderName: 'X-Secret-Key' }
    )

    expect(result.input).toEqual({ headers: { 'x-event-name': 'created' } })
  })

  /**
   * The denylist is leaky by construction, so the token is withheld by value too: a sender that
   * repeats it under a header name nobody anticipated is the case a name list cannot cover.
   */
  it('withholds any header carrying the configured token, whatever it is named', async () => {
    const result = await withHeaders(
      { 'x-vendor-signature': 'not-a-real-token-fixture', 'x-event-name': 'created' },
      { token: 'not-a-real-token-fixture' }
    )

    expect(result.input).toEqual({ headers: { 'x-event-name': 'created' } })
  })

  it('withholds a header that merely embeds the token', async () => {
    const result = await withHeaders(
      { 'x-vendor-auth': 'Token not-a-real-token-fixture' },
      {
        token: 'not-a-real-token-fixture',
      }
    )

    expect(result.input).not.toHaveProperty('headers')
  })

  /**
   * A short token would match unrelated header values and quietly strip useful headers, so value
   * matching only applies above a length where a collision stops being plausible.
   */
  it('does not value-match a token too short to be distinctive', async () => {
    const result = await withHeaders({ 'x-region': 'us' }, { token: 'us' })

    expect(result.input).toEqual({ headers: { 'x-region': 'us' } })
  })
})

describe('genericHandler delivery methods', () => {
  /**
   * The editor writes booleans, but a YAML- or Copilot-authored workflow can write the string
   * `'false'`, which is truthy. Reading that as "on" would silently ship the opposite of the
   * setting the user sees.
   */
  it('treats a stringified "false" flag as off', async () => {
    const ctx = context({ event: 'test' }, {}, { method: 'DELETE' })
    ;(ctx.webhook.providerConfig as Record<string, unknown>).acceptOtherMethods = 'false'

    const result = await genericHandler.formatInput!(ctx)

    expect(result.input).not.toHaveProperty('method')
  })
})
