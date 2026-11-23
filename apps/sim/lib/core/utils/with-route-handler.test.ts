import { loggerMock } from '@sim/testing'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '@/lib/core/utils/http-error'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/** Captured at import time: Vitest clears mock call history before every test. */
const routeHandlerLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi.mocked(loggerMock.createLogger).mock.calls.findIndex(([name]) => name === 'RouteHandler')
]?.value

class TestHttpError extends HttpError {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
  }
}

describe('withRouteHandler', () => {
  it('carries the workflow call chain into the request context', async () => {
    const seen: unknown[] = []
    vi.mocked(loggerMock.runWithRequestContext).mockImplementationOnce((context, fn) => {
      seen.push(context)
      return fn()
    })
    const handler = withRouteHandler(async () => NextResponse.json({ ok: true }))

    await handler(
      new NextRequest('http://localhost/api/test', { headers: { 'x-sim-via': 'wf-1, wf-2' } }),
      undefined
    )

    expect(seen[0]).toEqual(expect.objectContaining({ callChain: ['wf-1', 'wf-2'] }))
  })

  it('resolves the sending client into the request context for logs and analytics', async () => {
    const seen: unknown[] = []
    vi.mocked(loggerMock.runWithRequestContext).mockImplementationOnce((context, fn) => {
      seen.push(context)
      return fn()
    })
    const handler = withRouteHandler(async () => NextResponse.json({ ok: true }))

    await handler(
      new NextRequest('http://localhost/api/test', {
        headers: { 'x-sim-client-info': 'cli/2.1.2; node/22.14.0; agent/claude-code' },
      }),
      undefined
    )

    expect(seen[0]).toEqual(
      expect.objectContaining({
        client: expect.objectContaining({
          surface: 'cli',
          version: '2.1.2',
          agent: 'claude-code',
          source: 'header',
        }),
      })
    )
  })

  it('classifies errors after a client disconnect without using the unhandled fallback', async () => {
    routeHandlerLogger?.info.mockClear()
    routeHandlerLogger?.error.mockClear()

    const controller = new AbortController()
    const clientAbortResponse = vi.fn(() =>
      NextResponse.json({ error: 'Client cancelled request' }, { status: 499 })
    )
    const unhandledErrorResponse = vi.fn(() =>
      NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    )
    const handler = withRouteHandler(
      async () => {
        controller.abort()
        throw Object.assign(new Error('Premature close'), {
          code: 'ERR_STREAM_PREMATURE_CLOSE',
        })
      },
      { clientAbortResponse, unhandledErrorResponse }
    )

    const response = await handler(
      new NextRequest('http://localhost/api/test', { signal: controller.signal }),
      undefined
    )

    expect(response.status).toBe(499)
    await expect(response.json()).resolves.toEqual({ error: 'Client cancelled request' })
    expect(clientAbortResponse).toHaveBeenCalledOnce()
    expect(unhandledErrorResponse).not.toHaveBeenCalled()
    expect(routeHandlerLogger?.error).not.toHaveBeenCalled()
    expect(routeHandlerLogger?.info).toHaveBeenCalledWith('Client closed request', {
      duration: expect.any(Number),
      status: 499,
    })
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('lets a route family render a typed error before its generic fallback', async () => {
    const unhandledErrorResponse = vi.fn(() =>
      NextResponse.json({ family: 'generic' }, { status: 500 })
    )
    const handler = withRouteHandler(
      async () => {
        throw new TestHttpError('Locked', 423)
      },
      {
        typedErrorResponse: ({ error, status }) =>
          NextResponse.json({ family: 'typed', error: error.message }, { status }),
        unhandledErrorResponse,
      }
    )

    const response = await handler(new NextRequest('http://localhost/api/test'), undefined)

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({ family: 'typed', error: 'Locked' })
    expect(unhandledErrorResponse).not.toHaveBeenCalled()
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it.each([Number.NaN, 399, 429.5, 600])(
    'does not expose an invalid typed status %s',
    async (statusCode) => {
      const handler = withRouteHandler(
        async () => {
          throw new TestHttpError('Do not expose', statusCode)
        },
        {
          typedErrorResponse: ({ status }) => NextResponse.json({ family: 'typed' }, { status }),
          unhandledErrorResponse: () => NextResponse.json({ family: 'generic' }, { status: 500 }),
        }
      )

      const response = await handler(new NextRequest('http://localhost/api/test'), undefined)

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({ family: 'generic' })
    }
  )

  describe('a database that is temporarily unavailable', () => {
    const SQL = 'select "secret_column" from "workflow_execution_logs" where "id" = $1'

    function failedQuery(code: string, message: string): DrizzleQueryError {
      return new DrizzleQueryError(SQL, ['id-1'], Object.assign(new Error(message), { code }))
    }

    function familyRoute(error: unknown) {
      return withRouteHandler(
        async () => {
          throw error
        },
        {
          typedErrorResponse: ({ error: typed, status }) =>
            NextResponse.json({ family: 'typed', error: typed.message }, { status }),
          unhandledErrorResponse: () => NextResponse.json({ family: 'generic' }, { status: 500 }),
        }
      )
    }

    it.each([
      [
        'a replica recovery conflict',
        failedQuery('40001', 'canceling statement due to conflict with recovery'),
      ],
      ['a statement timeout', failedQuery('57014', 'canceling statement due to statement timeout')],
      [
        'a connection lost under the query',
        failedQuery('CONNECTION_CLOSED', 'write CONNECTION_CLOSED'),
      ],
      [
        'a server restarting',
        failedQuery('57P01', 'terminating connection due to administrator command'),
      ],
    ])('answers a read failing on %s with a retryable 503', async (_, error) => {
      const response = await familyRoute(error)(
        new NextRequest('http://localhost/api/test'),
        undefined
      )

      expect(response.status).toBe(503)
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
      const body = await response.json()
      expect(body.family).toBe('typed')
      expect(JSON.stringify(body)).not.toContain('secret_column')
    })

    it('answers a HEAD the same way as its GET', async () => {
      const response = await familyRoute(
        failedQuery('40001', 'canceling statement due to conflict with recovery')
      )(new NextRequest('http://localhost/api/test', { method: 'HEAD' }), undefined)

      expect(response.status).toBe(503)
    })

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'leaves a %s unhandled, since an earlier statement may already have committed',
      async (method) => {
        const response = await familyRoute(
          failedQuery('40001', 'canceling statement due to conflict with recovery')
        )(new NextRequest('http://localhost/api/test', { method }), undefined)

        expect(response.status).toBe(500)
        expect(response.headers.get('Retry-After')).toBeNull()
      }
    )

    it.each([
      ['a user-requested cancel', failedQuery('57014', 'canceling statement due to user request')],
      ['a permanent query error', failedQuery('42601', 'syntax error at or near ")"')],
      [
        'a socket reset outside any query',
        Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      ],
    ])('leaves %s on a read unhandled', async (_, error) => {
      const response = await familyRoute(error)(
        new NextRequest('http://localhost/api/test'),
        undefined
      )

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({ family: 'generic' })
    })
  })
})
