/**
 * @vitest-environment node
 */
import { getRequestContext } from '@sim/logger'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { mockEnforceUserRateLimit } = vi.hoisted(() => ({
  mockEnforceUserRateLimit: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
}))

import { defineRouteContract } from '@/lib/api/contracts'
import {
  defineInternalJsonRoute,
  InternalUnauthenticatedError,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes/internal-json-route'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'

const mockGetRequestContext = vi.mocked(getRequestContext)

class TestLockedError extends HttpError {
  readonly statusCode = 423
}

const operation = { id: 'test.read' } as const
const auth = {
  authenticate: vi.fn(async () => ({
    kind: 'session' as const,
    userId: 'user-1',
    sessionId: 'session-1',
  })),
}

const contract = defineRouteContract({
  method: 'GET',
  path: '/api/test/internal-json-route',
  response: {
    mode: 'json',
    schema: z.object({ value: z.string() }),
  },
})

describe('defineInternalJsonRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRequestContext.mockReturnValue(undefined)
  })

  it('uses the use-case result directly when it already matches the contract', async () => {
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          return { value: 'ok' }
        },
      },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ value: 'ok' })
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('applies a user-scoped admission limit after authentication and before execution', async () => {
    const execute = vi.fn(async () => ({ value: 'unreachable' }))
    mockEnforceUserRateLimit.mockResolvedValueOnce(
      NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: 60_000 },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    )
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.user({ bucketName: 'test.read' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: { operation, execute },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded',
      retryAfter: 60_000,
    })
    expect(mockEnforceUserRateLimit).toHaveBeenCalledWith('test.read', 'user-1', undefined)
    expect(execute).not.toHaveBeenCalled()
  })

  it('renders typed error descriptors through the shared builder', async () => {
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute(): Promise<{ value: string }> {
          throw new OrchestrationError('conflict', 'Already exists')
        },
      },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Already exists' })
  })

  it('preserves HttpError status through the internal envelope', async () => {
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute(): Promise<{ value: string }> {
          throw new TestLockedError('Table imports are locked')
        },
      },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({
      error: 'Table imports are locked',
      requestId: expect.any(String),
    })
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('rejects invalid error statuses immediately', () => {
    expect(() => internalErrorResponse(200, { error: 'Invalid' })).toThrow(
      'Internal error responses require a 4xx or 5xx status'
    )
  })

  it('projects a classified orchestration error as a bare error envelope', async () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-orchestration' })

    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          throw new OrchestrationError('not_found', 'Widget not found')
        },
      },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({ error: 'Widget not found', requestId: 'req-orchestration' })
    expect(body).not.toHaveProperty('success')
  })

  it('stamps the request id onto an authentication failure', async () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-auth' })

    const handler = defineInternalJsonRoute({
      contract,
      auth: {
        authenticate: vi.fn(async () => {
          throw new InternalUnauthenticatedError('Unauthorized')
        }),
      },
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          return { value: 'unreachable' }
        },
      },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
      requestId: 'req-auth',
    })
  })

  it('stamps the request id onto a request parsing failure', async () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-parse' })

    const queryContract = defineRouteContract({
      method: 'GET',
      path: '/api/test/internal-json-route',
      query: z.object({ widgetId: z.string().min(1, 'widgetId is required') }),
      response: {
        mode: 'json',
        schema: z.object({ value: z.string() }),
      },
    })

    const handler = defineInternalJsonRoute({
      contract: queryContract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          return { value: 'unreachable' }
        },
      },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.requestId).toBe('req-parse')
  })

  it('applies static response headers to success and every failure stage', async () => {
    const staticHeaderContract = defineRouteContract({
      method: 'POST',
      path: '/api/test/internal-json-route',
      body: z.object({ outcome: z.enum(['success', 'failure']) }),
      response: { mode: 'json', schema: z.object({ value: z.string() }) },
    })
    const handler = defineInternalJsonRoute({
      contract: staticHeaderContract,
      auth: {
        async authenticate(request) {
          if (request.headers.get('x-reject-auth') === 'true') {
            throw new InternalUnauthenticatedError('Unauthorized')
          }
          return { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
        },
      },
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: ({ body }) => body.outcome,
      useCase: {
        operation,
        async execute({ input }) {
          if (input === 'failure') throw new Error('Unhandled')
          return { value: 'ok' }
        },
      },
      staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
    })

    const cases: Array<[NextRequest, number]> = [
      [
        new NextRequest('http://localhost/api/test/internal-json-route', {
          method: 'POST',
          body: JSON.stringify({ outcome: 'success' }),
        }),
        200,
      ],
      [
        new NextRequest('http://localhost/api/test/internal-json-route', {
          method: 'POST',
          headers: { 'x-reject-auth': 'true' },
        }),
        401,
      ],
      [
        new NextRequest('http://localhost/api/test/internal-json-route', {
          method: 'POST',
          body: '{',
        }),
        400,
      ],
      [
        new NextRequest('http://localhost/api/test/internal-json-route', {
          method: 'POST',
          body: JSON.stringify({ outcome: 'failure' }),
        }),
        500,
      ],
    ]

    for (const [request, expectedStatus] of cases) {
      const response = await handler(request)
      expect(response.status).toBe(expectedStatus)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    }
  })

  it('orders auth, rate limiting, parsing, async mapping, and application execution', async () => {
    const events: string[] = []
    const orderedContract = defineRouteContract({
      method: 'POST',
      path: '/api/test/internal-json-route',
      body: z.object({ value: z.string() }).transform((body) => {
        events.push('parse')
        return body
      }),
      response: { mode: 'json', schema: z.object({ value: z.string() }) },
    })
    const handler = defineInternalJsonRoute({
      contract: orderedContract,
      auth: {
        async authenticate() {
          events.push('auth')
          return { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
        },
      },
      operation,
      rateLimit: {
        kind: 'none',
        reason: 'Unit test',
        async enforce() {
          events.push('rate')
        },
      },
      errorPolicy: internalOrchestrationErrorPolicy,
      async mapInput({ body }) {
        events.push('map:start')
        await Promise.resolve()
        events.push('map:end')
        return body.value
      },
      useCase: {
        operation,
        async execute({ input }) {
          events.push('use-case')
          return { value: input }
        },
      },
    })

    const response = await handler(
      new NextRequest('http://localhost/api/test/internal-json-route', {
        method: 'POST',
        body: JSON.stringify({ value: 'ok' }),
      })
    )

    expect(response.status).toBe(200)
    expect(events).toEqual(['auth', 'rate', 'parse', 'map:start', 'map:end', 'use-case'])
  })

  it('projects async mapping errors before application execution', async () => {
    const execute = vi.fn()
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      async mapInput() {
        await Promise.resolve()
        throw new OrchestrationError('validation', 'Invalid mapped input')
      },
      useCase: { operation, execute },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid mapped input' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('validates the contract response before invoking the finalizer', async () => {
    const finalizeResponse = vi.fn()
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          return { value: 42 }
        },
      },
      present: ({ value }) => ({ value: value as unknown as string }),
      finalizeResponse,
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(500)
    expect(finalizeResponse).not.toHaveBeenCalled()
  })

  it('projects finalizer failures through the declared error policy', async () => {
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          return { value: 'ok' }
        },
      },
      finalizeResponse() {
        throw new OrchestrationError('conflict', 'Metadata conflict')
      },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Metadata conflict' })
  })

  it('appends finalizer metadata while preserving the success status and declared headers', async () => {
    const createdContract = defineRouteContract({
      method: 'POST',
      path: '/api/test/internal-json-route',
      response: {
        mode: 'json',
        schema: z.object({ value: z.string() }),
        status: 201,
      },
    })
    const handler = defineInternalJsonRoute({
      contract: createdContract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          return { value: 'ok' }
        },
      },
      responseHeaders: () => ({ 'x-contract-header': 'preserved' }),
      finalizeResponse: ({ body }) => ({
        bodyFields: { __privateMetadata: { value: body.value } },
        headers: { 'x-private-metadata': 'v1' },
      }),
    })

    const response = await handler(
      new NextRequest('http://localhost/api/test/internal-json-route', { method: 'POST' })
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('x-contract-header')).toBe('preserved')
    expect(response.headers.get('x-private-metadata')).toBe('v1')
    await expect(response.json()).resolves.toEqual({
      value: 'ok',
      __privateMetadata: { value: 'ok' },
    })
  })

  it('selects a declared success status from the application result', async () => {
    const replayableContract = defineRouteContract({
      method: 'POST',
      path: '/api/test/internal-json-route',
      response: {
        mode: 'json',
        schema: z.object({ value: z.string() }),
        status: [200, 201],
      },
    })
    const handler = defineInternalJsonRoute({
      contract: replayableContract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          return { value: 'created', created: true }
        },
      },
      present: ({ value }) => ({ value }),
      statusForResult: ({ created }) => (created ? 201 : 200),
    })

    const response = await handler(
      new NextRequest('http://localhost/api/test/internal-json-route', { method: 'POST' })
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ value: 'created' })
  })

  it('fails closed when the application selects an undeclared success status', async () => {
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          return { value: 'ok' }
        },
      },
      statusForResult: () => 201,
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
