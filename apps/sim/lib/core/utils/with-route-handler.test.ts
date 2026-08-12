/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '@/lib/core/utils/http-error'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

class TestHttpError extends HttpError {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
  }
}

describe('withRouteHandler', () => {
  it('classifies errors after a client disconnect without using the unhandled fallback', async () => {
    const routeHandlerLogger = vi.mocked(loggerMock.createLogger).mock.results[
      vi.mocked(loggerMock.createLogger).mock.calls.findIndex(([name]) => name === 'RouteHandler')
    ]?.value
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
})
