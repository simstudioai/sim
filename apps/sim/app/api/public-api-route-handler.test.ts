/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { recordRateLimitSnapshot } from '@/lib/api/server/rate-limit-context'

const { mockCheckRateLimit, mockHandler, mockLoggerError, mockLoggerInfo, requestContextState } =
  vi.hoisted(() => ({
    mockCheckRateLimit: vi.fn(),
    mockHandler: vi.fn(),
    mockLoggerError: vi.fn(),
    mockLoggerInfo: vi.fn(),
    requestContextState: {
      current: undefined as { requestId: string; method?: string; path?: string } | undefined,
    },
  }))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: (...arguments_: unknown[]) =>
      mockLoggerInfo(requestContextState.current?.requestId, ...arguments_),
    warn: vi.fn(),
    error: (...arguments_: unknown[]) =>
      mockLoggerError(requestContextState.current?.requestId, ...arguments_),
  }),
  getRequestContext: () => requestContextState.current,
  runWithRequestContext: async <T>(
    context: { requestId: string; method?: string; path?: string },
    callback: () => T | Promise<T>
  ): Promise<T> => {
    requestContextState.current = context
    try {
      return await callback()
    } finally {
      requestContextState.current = undefined
    }
  },
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: () => requestContextState.current?.requestId ?? 'outer-request-id',
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'

const RATE_LIMIT = {
  allowed: true,
  limit: 400,
  remaining: 399,
  resetAt: new Date('2026-08-06T20:00:00.000Z'),
  userId: 'user-1',
  keyType: 'personal' as const,
}

const queryContract = defineRouteContract({
  method: 'POST',
  path: '/api/test/:itemId',
  params: z.object({ itemId: z.string().min(1) }),
  query: z.object({ limit: z.coerce.number().int().positive() }),
  body: z.object({ name: z.string().min(1) }),
  response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
})

const listContract = defineRouteContract({
  method: 'GET',
  path: '/api/test',
  query: z.object({ workspaceId: z.string().min(1) }),
  response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
})

const POST = withPublicApiRouteHandler({
  contract: queryContract,
  rateLimitEndpoint: 'table-rows',
  parseOptions: {
    maxBodyBytes: 32,
    payloadTooLargeResponse: () =>
      NextResponse.json({ error: 'Custom payload limit response' }, { status: 413 }),
  },
  handler: async (arguments_) => {
    mockHandler(arguments_)
    return NextResponse.json({ ok: true })
  },
})

const GET = withPublicApiRouteHandler({
  contract: listContract,
  rateLimitEndpoint: 'tables',
  handler: async (arguments_) => {
    mockHandler(arguments_)
    return NextResponse.json({ ok: true })
  },
})

const FAILING_GET = withPublicApiRouteHandler({
  contract: listContract,
  rateLimitEndpoint: 'tables',
  handler: async () => {
    throw new Error('handler failed')
  },
})

function postRequest(body: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/test/item-1?limit=10', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

function listRequest(query = 'workspaceId=workspace-1'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/test?${query}`)
}

describe('withPublicApiRouteHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockImplementation(async (request: NextRequest) => {
      recordRateLimitSnapshot(request, RATE_LIMIT)
      return RATE_LIMIT
    })
  })

  it.each([
    ['authentication failure', 401],
    ['rate-limit denial', 429],
  ])('short-circuits %s before reading or parsing the body', async (_label, status) => {
    mockCheckRateLimit.mockImplementation(async (request: NextRequest) => {
      if (status === 401) {
        return {
          allowed: false,
          limit: 0,
          remaining: 0,
          resetAt: new Date('2026-08-06T20:00:00.000Z'),
          error: 'API key required',
        }
      }

      recordRateLimitSnapshot(request, RATE_LIMIT)
      return { ...RATE_LIMIT, allowed: false, remaining: 0, retryAfterMs: 30_000 }
    })
    const request = postRequest('{not valid json')

    const response = await POST(request, { params: { itemId: 'item-1' } })

    expect(response.status).toBe(status)
    expect(request.bodyUsed).toBe(false)
    expect(mockHandler).not.toHaveBeenCalled()
    expect(mockCheckRateLimit).toHaveBeenCalledWith(request, 'table-rows')
    if (status === 401) {
      expect(response.headers.get('X-RateLimit-Limit')).toBe('0')
    } else {
      expect(response.headers.get('Retry-After')).toBe('30')
      expect(response.headers.get('X-RateLimit-Limit')).toBe('400')
    }
  })

  it('fails fast when an allowed rate-limit result has no user ID', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...RATE_LIMIT, userId: undefined })

    const response = await GET(listRequest())

    expect(response.status).toBe(500)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('returns a contract validation response after authentication', async () => {
    const response = await POST(postRequest(JSON.stringify({ name: '' })), {
      params: { itemId: 'item-1' },
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('400')
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('forwards the body-size parse option', async () => {
    const response = await POST(postRequest(JSON.stringify({ name: 'x'.repeat(40) })), {
      params: { itemId: 'item-1' },
    })

    expect(response.status).toBe(413)
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('399')
    await expect(response.json()).resolves.toEqual({ error: 'Custom payload limit response' })
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('provides parsed params, query, body, and auth to the handler', async () => {
    const request = postRequest(JSON.stringify({ name: 'Ada' }))
    const response = await POST(request, { params: Promise.resolve({ itemId: 'item-1' }) })

    expect(response.status).toBe(200)
    expect(mockHandler).toHaveBeenCalledWith({
      request,
      input: {
        params: { itemId: 'item-1' },
        query: { limit: 10 },
        body: { name: 'Ada' },
        headers: undefined,
      },
      auth: {
        requestId: 'outer-request-id',
        userId: 'user-1',
        rateLimit: RATE_LIMIT,
      },
    })
    expect(response.headers.get('x-request-id')).toBe('outer-request-id')
    expect(response.headers.get('X-RateLimit-Reset')).toBe(RATE_LIMIT.resetAt.toISOString())
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'outer-request-id',
      'OK',
      expect.objectContaining({ status: 200 })
    )
  })

  it('supports direct invocation without a route context', async () => {
    const request = listRequest()
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mockHandler.mock.calls[0][0].input.query).toEqual({ workspaceId: 'workspace-1' })
    expect(mockCheckRateLimit).toHaveBeenCalledWith(request, 'tables')
  })

  it('keeps rate-limit and request headers on unhandled endpoint errors', async () => {
    const response = await FAILING_GET(listRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(response.headers.get('x-request-id')).toBe('outer-request-id')
    expect(response.headers.get('X-RateLimit-Limit')).toBe('400')
    expect(mockLoggerError).toHaveBeenCalledWith(
      'outer-request-id',
      'Unhandled route error',
      expect.objectContaining({ error: 'handler failed' })
    )
  })
})
