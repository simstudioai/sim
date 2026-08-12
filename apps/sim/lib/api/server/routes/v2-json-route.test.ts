/**
 * @vitest-environment node
 */
import type { PersonalApiKeyPrincipal } from '@sim/auth/principal'
import {
  MockV2ApiKeyUnauthenticatedError,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import type { ParsedRequest, ParseRequestOptions } from '@/lib/api/server/validation'
import type { OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'

class TestLockedError extends HttpError {
  readonly statusCode = 423
}

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

import type { V2ApiKeyAuthContext } from '@/lib/api/server/routes/v2-api-key-auth'
import {
  defineV2JsonRoute,
  type V2ErrorPolicy,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes/v2-json-route'

const operation = { id: 'widgets.update' } as const
const principal: PersonalApiKeyPrincipal = {
  kind: 'personal_api_key',
  userId: 'user-1',
  keyId: 'key-1',
}
const auth = {
  principal,
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
  rateLimitSubscription: null,
  keyType: 'personal',
} satisfies V2ApiKeyAuthContext
const resetAt = new Date('2026-08-08T20:00:00.000Z')
const allowedRate = { allowed: true, remaining: 99, resetAt }

const contract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/widgets',
  body: z.object({ value: z.string() }).strict(),
  response: {
    mode: 'json',
    status: 201,
    schema: z.object({ data: z.object({ value: z.string() }) }),
  },
})

interface Input {
  value: string
}

interface Result {
  value: string
}

type Execute = OperationUseCase<typeof operation, Input, Result>['execute']

interface HandlerOverrides {
  beforeParse?: (args: {
    request: NextRequest
    principal: PersonalApiKeyPrincipal
    params: Record<string, string | string[] | undefined>
  }) => void | Promise<void>
  errorPolicy?: V2ErrorPolicy
  execute?: Execute
  mapInput?: (input: ParsedRequest<typeof contract>) => Input
  onSuccess?: (args: {
    principal: PersonalApiKeyPrincipal
    input: Input
    result: Result
  }) => void | Promise<void>
  present?: (result: Result) => { data: { value: string } } | Promise<{ data: { value: string } }>
  statusForResult?: (result: Result) => number
  parseOptions?: Omit<ParseRequestOptions, 'validationErrorResponse'>
}

function createHandler(overrides: HandlerOverrides = {}) {
  const useCase: OperationUseCase<typeof operation, Input, Result> = {
    operation,
    execute:
      overrides.execute ??
      (async ({ input }) => ({
        value: input.value,
      })),
  }
  return defineV2JsonRoute({
    contract,
    auth: v2ApiKeyAuth,
    operation,
    rateLimit: v2RateLimits.publicApi,
    errorPolicy: overrides.errorPolicy ?? v2OrchestrationErrorPolicy,
    beforeParse: overrides.beforeParse,
    mapInput: overrides.mapInput ?? (({ body }) => body),
    useCase,
    present: overrides.present ?? ((result) => ({ data: result })),
    onSuccess: overrides.onSuccess,
    statusForResult: overrides.statusForResult,
    parseOptions: overrides.parseOptions,
  })
}

function request(body: unknown = { value: 'ok' }, signal?: AbortSignal): NextRequest {
  return new NextRequest('http://localhost/api/v2/widgets', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
    signal,
  })
}

/**
 * A body the size guard rejects on the declared `content-length` alone, which is
 * how an oversized request is refused before any of it is buffered.
 */
function oversizedRequest(maxBodyBytes: number): NextRequest {
  return new NextRequest('http://localhost/api/v2/widgets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'secret',
      'content-length': String(maxBodyBytes + 1),
    },
    body: JSON.stringify({ value: 'ok' }),
  })
}

describe('defineV2JsonRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue({ allowed: true, remaining: 599, resetAt })
    v2RouteMocks.operationRate.mockResolvedValue(allowedRate)
  })

  it('runs admission, parsing, use case, presentation, and success effects in order', async () => {
    const events: string[] = []
    v2RouteMocks.preauthRate.mockImplementation(async () => {
      events.push('ip-limit')
      return { allowed: true, remaining: 599, resetAt }
    })
    v2RouteMocks.authenticate.mockImplementation(async () => {
      events.push('authenticate')
      return { ...auth, rateLimitSubjectIds: ['api-key:key-1'] as const }
    })
    v2RouteMocks.gate.mockImplementation(async () => {
      events.push('rollout')
      return null
    })
    v2RouteMocks.operationRate.mockImplementation(async () => {
      events.push('operation-limit')
      return allowedRate
    })

    const handler = createHandler({
      beforeParse: () => {
        events.push('before-parse')
      },
      mapInput: ({ body }) => {
        events.push('parse-and-map')
        return body
      },
      execute: async ({ input }) => {
        events.push('use-case')
        return input
      },
      present: (result) => {
        events.push('presentation')
        return { data: result }
      },
      onSuccess: () => {
        events.push('on-success')
      },
    })

    const response = await handler(request())

    expect(response.status).toBe(201)
    expect(events).toEqual([
      'ip-limit',
      'authenticate',
      'rollout',
      'operation-limit',
      'before-parse',
      'parse-and-map',
      'use-case',
      'presentation',
      'on-success',
    ])
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('fails closed before authentication when the IP bucket cannot admit the request', async () => {
    v2RouteMocks.preauthRate.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterMs: 60_000,
    })

    const response = await createHandler()(request())

    expect(response.status).toBe(429)
    expect(v2RouteMocks.preauthRate).toHaveBeenCalledWith(
      expect.stringMatching(/^v2:preauth:ip:/),
      expect.objectContaining({ maxTokens: 600 }),
      { failClosed: true }
    )
    expect(v2RouteMocks.authenticate).not.toHaveBeenCalled()
    expect(v2RouteMocks.gate).not.toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).not.toHaveBeenCalled()
  })

  it('renders invalid credentials as 401 without continuing admission', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(
      new MockV2ApiKeyUnauthenticatedError('API key required')
    )

    const response = await createHandler()(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', message: 'API key required' },
    })
    expect(v2RouteMocks.gate).not.toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).not.toHaveBeenCalled()
  })

  it('short-circuits parsing and operation rate limiting when rollout denies admission', async () => {
    const mapInput = vi.fn<(input: ParsedRequest<typeof contract>) => Input>()
    const execute = vi.fn<Execute>()
    v2RouteMocks.gate.mockResolvedValueOnce(
      NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })
    )

    const response = await createHandler({ mapInput, execute })(request())

    expect(response.status).toBe(404)
    expect(v2RouteMocks.operationRate).not.toHaveBeenCalled()
    expect(mapInput).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    {
      stage: 'authentication',
      fail: () =>
        v2RouteMocks.authenticate.mockRejectedValueOnce(new Error('auth store unavailable')),
    },
    {
      stage: 'rollout gate',
      fail: () => v2RouteMocks.gate.mockRejectedValueOnce(new Error('gate store unavailable')),
    },
    {
      stage: 'operation rate limit',
      fail: () => v2RouteMocks.operationRate.mockRejectedValue(new Error('rate store unavailable')),
    },
  ])('maps $stage infrastructure failure to 503', async ({ fail }) => {
    fail()

    const response = await createHandler()(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      },
    })
  })

  it('enforces every rate subject and publishes the most restrictive allowed bucket', async () => {
    const restrictiveReset = new Date('2026-08-08T21:00:00.000Z')
    v2RouteMocks.operationRate.mockImplementation(async (key: string) =>
      key.endsWith('user:user-1')
        ? { allowed: true, remaining: 12, resetAt: restrictiveReset }
        : { allowed: true, remaining: 80, resetAt }
    )

    const response = await createHandler()(request())

    expect(response.status).toBe(201)
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(v2RouteMocks.operationRate).toHaveBeenCalledWith(
      'v2:widgets.update:api-key:key-1',
      expect.objectContaining({ maxTokens: 100 })
    )
    expect(v2RouteMocks.operationRate).toHaveBeenCalledWith(
      'v2:widgets.update:user:user-1',
      expect.objectContaining({ maxTokens: 100 })
    )
    expect(response.headers.get('X-RateLimit-Limit')).toBe('100')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('12')
    expect(response.headers.get('X-RateLimit-Reset')).toBe(restrictiveReset.toISOString())
  })

  it('rejects when any rate subject is denied, regardless of other bucket capacity', async () => {
    const mapInput = vi.fn<(input: ParsedRequest<typeof contract>) => Input>()
    const execute = vi.fn<Execute>()
    v2RouteMocks.operationRate.mockImplementation(async (key: string) =>
      key.endsWith('user:user-1')
        ? { allowed: false, remaining: 0, resetAt, retryAfterMs: 30_000 }
        : { allowed: true, remaining: 99, resetAt }
    )

    const response = await createHandler({ mapInput, execute })(request())

    expect(response.status).toBe(429)
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(mapInput).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('short-circuits parsing when beforeParse rejects the admitted principal', async () => {
    const mapInput = vi.fn<(input: ParsedRequest<typeof contract>) => Input>()
    const execute = vi.fn<Execute>()
    const response = await createHandler({
      beforeParse: () => {
        throw new OrchestrationError('forbidden', 'Header policy denied')
      },
      mapInput,
      execute,
    })(request())

    expect(response.status).toBe(403)
    expect(mapInput).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('99')
  })

  it('authenticates, gates, and rate-limits before parse rejection, then stops', async () => {
    const execute = vi.fn<Execute>()
    const present = vi.fn<(result: Result) => { data: { value: string } }>()
    const onSuccess = vi.fn()
    const mapInput = vi.fn<(input: ParsedRequest<typeof contract>) => Input>()
    const response = await createHandler({ execute, present, onSuccess, mapInput })(request({}))

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalledOnce()
    expect(v2RouteMocks.gate).toHaveBeenCalledOnce()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mapInput).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(present).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('99')
  })

  it('short-circuits presentation and onSuccess after a typed use-case failure', async () => {
    const present = vi.fn<(result: Result) => { data: { value: string } }>()
    const onSuccess = vi.fn()
    const response = await createHandler({
      execute: async () => {
        throw new OrchestrationError('conflict', 'Already exists')
      },
      present,
      onSuccess,
    })(request())

    expect(response.status).toBe(409)
    expect(present).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('99')
  })

  it('preserves HttpError status through the v2 envelope', async () => {
    const response = await createHandler({
      execute: async () => {
        throw new TestLockedError('Resource is locked')
      },
    })(request())

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'LOCKED', message: 'Resource is locked' },
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('99')
  })

  it('renders a client disconnect through the v2 cancellation envelope', async () => {
    const controller = new AbortController()
    const response = await createHandler({
      execute: async () => {
        controller.abort()
        throw Object.assign(new Error('Premature close'), {
          code: 'ERR_STREAM_PREMATURE_CLOSE',
        })
      },
    })(request(undefined, controller.signal))

    expect(response.status).toBe(499)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'CLIENT_CLOSED_REQUEST', message: 'Client cancelled request' },
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('99')
  })

  it('validates the presented response before onSuccess', async () => {
    const onSuccess = vi.fn()
    const response = await createHandler({
      present: () =>
        ({ data: { value: 42 } }) as unknown as {
          data: { value: string }
        },
      onSuccess,
    })(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('turns an onSuccess failure into an error response after successful presentation', async () => {
    const present = vi.fn((result: Result) => ({ data: result }))
    const response = await createHandler({
      present,
      onSuccess: () => {
        throw new OrchestrationError('conflict', 'Success projection failed')
      },
    })(request())

    expect(present).toHaveBeenCalledOnce()
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'CONFLICT', message: 'Success projection failed' },
    })
  })

  it('fails fast on an invalid dynamic success status', async () => {
    const response = await createHandler({ statusForResult: () => 400 })(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })

  it('renders an oversized body in the v2 error envelope without a per-route override', async () => {
    const maxBodyBytes = 64
    const response = await createHandler({ parseOptions: { maxBodyBytes } })(
      oversizedRequest(maxBodyBytes)
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('lets a route override the default payload-too-large response', async () => {
    const maxBodyBytes = 64
    const response = await createHandler({
      parseOptions: {
        maxBodyBytes,
        payloadTooLargeResponse: () =>
          NextResponse.json(
            { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Import archive is too large' } },
            { status: 413 }
          ),
      },
    })(oversizedRequest(maxBodyBytes))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Import archive is too large' },
    })
  })
})
