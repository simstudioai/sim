/**
 * @vitest-environment node
 */

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
