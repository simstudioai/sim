/**
 * @vitest-environment node
 */
import type { PersonalApiKeyPrincipal } from '@sim/auth/principal'
import {
  MockV2ApiKeyUnauthenticatedError,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import type { ParsedRequest, ParseRequestOptions } from '@/lib/api/server/validation'
import {
  NoWorkspaceAccessError,
  type OperationUseCase,
  PrincipalKindAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'

class TestLockedError extends HttpError {
  readonly statusCode = 423
}

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import type { V2ApiKeyAuthContext } from '@/lib/api/server/routes/v2-api-key-auth'
import {
  admitOptionalV2Request,
  admitV2Request,
  defineV2JsonRoute,
  type V2ErrorPolicy,
  v2ApiKeyAuth,
  v2HeadAuthorizationResponse,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes/v2-json-route'

const operation = { id: 'widgets.update', capability: 'none', oauthScope: 'api:write' } as const
const principal: PersonalApiKeyPrincipal = {
  kind: 'personal_api_key',
  userId: 'user-1',
  keyId: 'key-1',
}
const auth = {
  principal,
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
  rateLimitSubscription: null,
  keyType: 'personal',
  keyExpiresAt: null,
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
    v2RouteMocks.preauthRate.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt,
    })
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
    expect(v2RouteMocks.operationRate).not.toHaveBeenCalled()
  })

  it('renders invalid credentials as 401 without continuing admission', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(
      new MockV2ApiKeyUnauthenticatedError('API key or OAuth access token required')
    )

    const response = await createHandler()(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', message: 'API key or OAuth access token required' },
    })
    expect(v2RouteMocks.operationRate).not.toHaveBeenCalled()
  })

  it.each([
    {
      stage: 'authentication',
      fail: () =>
        v2RouteMocks.authenticate.mockRejectedValueOnce(new Error('auth store unavailable')),
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

  it('authenticates and rate-limits before parse rejection, then stops', async () => {
    const execute = vi.fn<Execute>()
    const present = vi.fn<(result: Result) => { data: { value: string } }>()
    const onSuccess = vi.fn()
    const mapInput = vi.fn<(input: ParsedRequest<typeof contract>) => Input>()
    const response = await createHandler({
      execute,
      present,
      onSuccess,
      mapInput,
    })(request({}))

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalledOnce()
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
      error: {
        code: 'CLIENT_CLOSED_REQUEST',
        message: 'Client cancelled request',
      },
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
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      },
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
            {
              error: {
                code: 'PAYLOAD_TOO_LARGE',
                message: 'Import archive is too large',
              },
            },
            { status: 413 }
          ),
      },
    })(oversizedRequest(maxBodyBytes))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Import archive is too large',
      },
    })
  })
})

/**
 * A body that cannot be read as JSON has two very different causes, and the
 * single `400 "Request body must be valid JSON"` describes only one of them: a
 * caller who sent a form-encoded body is told to go hunting for a syntax error
 * in a body that has none.
 *
 * These pin the split to the *classification* of an already-failing read. The
 * final two are the regression guard that keeps it from becoming a media-type
 * gate: a body that parses as JSON still succeeds no matter what the caller
 * declared, which is what keeps `curl -d '{…}'` (form-urlencoded by default)
 * and a headerless browser `fetch` (`text/plain`) working.
 */
describe('defineV2JsonRoute unreadable body classification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt,
    })
    v2RouteMocks.operationRate.mockResolvedValue(allowedRate)
  })

  /**
   * A `string` body makes undici *derive* `content-type: text/plain;charset=UTF-8`,
   * so omitting the header from `headers` is not enough to produce the
   * absent-media-type request — the `null` case has to send pre-encoded bytes.
   * The assertion is the guard that keeps that from silently drifting back:
   * without it the two `contentType === null` cases secretly re-test `text/plain`
   * and the `if (!header) return false` branch never runs.
   */
  function bodyRequest(contentType: string | null, body: string): NextRequest {
    const request = new NextRequest('http://localhost/api/v2/widgets', {
      method: 'POST',
      headers: {
        'x-api-key': 'secret',
        ...(contentType === null ? {} : { 'content-type': contentType }),
      },
      body: contentType === null ? new TextEncoder().encode(body) : body,
    })
    if (contentType === null) expect(request.headers.get('content-type')).toBeNull()
    return request
  }

  it('answers 415 when an unreadable body declared a non-JSON media type', async () => {
    const response = await createHandler()(
      bodyRequest('application/x-www-form-urlencoded', 'value=ok')
    )

    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Request body must be sent as application/json',
      },
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('keeps 400 for a truncated JSON body, whose media type was right', async () => {
    const response = await createHandler()(bodyRequest('application/json', '{"value":'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Request body must be valid JSON',
      },
    })
  })

  it('keeps 400 when the media type is absent rather than wrong', async () => {
    const response = await createHandler()(bodyRequest(null, '{"value":'))

    expect(response.status).toBe(400)
  })

  it('keeps 400 for text/plain, the default of a headerless browser fetch', async () => {
    const response = await createHandler()(bodyRequest('text/plain;charset=UTF-8', '{"value":'))

    expect(response.status).toBe(400)
  })

  it('accepts a JSON body sent under a non-JSON media type, as it does today', async () => {
    const response = await createHandler()(
      bodyRequest('application/x-www-form-urlencoded', JSON.stringify({ value: 'ok' }))
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ data: { value: 'ok' } })
  })

  it('accepts a JSON body sent with no media type at all', async () => {
    const response = await createHandler()(bodyRequest(null, JSON.stringify({ value: 'ok' })))

    expect(response.status).toBe(201)
  })

  it('keeps 400 for a structured JSON suffix media type', async () => {
    const response = await createHandler()(bodyRequest('application/merge-patch+json', '{"value":'))

    expect(response.status).toBe(400)
  })

  it('lets a route override the classification entirely', async () => {
    const response = await createHandler({
      parseOptions: {
        invalidJsonResponse: () =>
          NextResponse.json(
            {
              error: {
                code: 'BAD_REQUEST',
                message: 'Import archive is not JSON',
              },
            },
            { status: 400 }
          ),
      },
    })(bodyRequest('application/x-www-form-urlencoded', 'value=ok'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'BAD_REQUEST', message: 'Import archive is not JSON' },
    })
  })
})

/**
 * A `HEAD` on a route whose `GET` is not safe must answer the question the `GET`
 * would answer, minus the effect — not merely the question admission can answer.
 *
 * Returning {@link v2HeadNoEffect} straight after authenticate + rate-limit is
 * an existence oracle: any valid API key draws a bodiless 200 for a denied
 * principal kind, a nonexistent id, another tenant's workspace, and even a
 * request missing a required param, while the `GET` beside it answers 403. These
 * pin the builder to running the authorization phase and stopping before the
 * business phase.
 */
describe('defineV2JsonRoute HEAD on a route that is not head-safe', () => {
  const headContract = defineRouteContract({
    method: 'GET',
    path: '/api/v2/widgets/[widgetId]',
    params: z.object({ widgetId: z.string() }).strict(),
    query: z.object({ workspaceId: z.string().min(1) }).strict(),
    response: {
      mode: 'json',
      schema: z.object({ data: z.object({ value: z.string() }) }),
    },
  })

  type HeadInput = { widgetId: string; workspaceId: string }

  function createHeadHandler(overrides: {
    authorize?: (args: { input: HeadInput }) => Promise<void>
    execute?: () => Promise<Result>
    omitAuthorize?: boolean
  }) {
    const useCase: OperationUseCase<typeof operation, HeadInput, Result> = {
      operation,
      execute: overrides.execute ?? (async () => ({ value: 'ok' })),
      authorize: overrides.omitAuthorize ? undefined : (overrides.authorize ?? (async () => {})),
    }
    return defineV2JsonRoute({
      contract: headContract,
      auth: v2ApiKeyAuth,
      operation,
      headSafe: false,
      rateLimit: v2RateLimits.publicApi,
      errorPolicy: v2OrchestrationErrorPolicy,
      mapInput: ({ params, query }) => ({
        widgetId: params.widgetId,
        ...query,
      }),
      useCase,
      present: (result) => ({ data: result }),
    })
  }

  const headContext = { params: Promise.resolve({ widgetId: 'widget-1' }) }

  function headRequest(query = 'workspaceId=workspace-1'): NextRequest {
    return new NextRequest(`http://localhost/api/v2/widgets/widget-1?${query}`, {
      method: 'HEAD',
      headers: { 'x-api-key': 'secret' },
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt,
    })
    v2RouteMocks.operationRate.mockResolvedValue(allowedRate)
  })

  it('answers a denied principal kind with the status its GET would produce', async () => {
    const execute = vi.fn(async () => ({ value: 'ok' }))
    const response = await createHeadHandler({
      execute,
      authorize: async () => {
        throw new PrincipalKindAuthorizationError('workspace_api_key', operation.id)
      },
    })(headRequest(), headContext)

    expect(response.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  it('answers a nonexistent resource with 404 rather than confirming it exists', async () => {
    const execute = vi.fn(async () => ({ value: 'ok' }))
    const response = await createHeadHandler({
      execute,
      authorize: async () => {
        throw new OrchestrationError('not_found', 'Widget not found')
      },
    })(headRequest(), headContext)

    expect(response.status).toBe(404)
    expect(execute).not.toHaveBeenCalled()
  })

  it('answers an unauthorized workspace with the GET`s own refusal status', async () => {
    const execute = vi.fn(async () => ({ value: 'ok' }))
    const response = await createHeadHandler({
      execute,
      authorize: async () => {
        throw new NoWorkspaceAccessError()
      },
    })(headRequest('workspaceId=someone-elses-workspace'), headContext)

    expect(response.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects a missing required param instead of answering 200', async () => {
    const authorize = vi.fn(async () => {})
    const response = await createHeadHandler({ authorize })(headRequest(''), headContext)

    expect(response.status).toBe(400)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('answers an authorized probe bodiless without running the business phase', async () => {
    const execute = vi.fn(async () => ({ value: 'ok' }))
    const authorize = vi.fn(async () => {})
    const response = await createHeadHandler({ execute, authorize })(headRequest(), headContext)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: { widgetId: 'widget-1', workspaceId: 'workspace-1' },
      })
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses at definition time to build the route when the use case cannot authorize', () => {
    expect(() => createHeadHandler({ omitAuthorize: true })).toThrow(/authorize/)
  })

  /**
   * The definition-time guard is what a route hits, and it covers both builders
   * that answer a `HEAD` this way. This pins the responder's own behaviour if it
   * is ever reached another way: a missing authorization phase has to fail,
   * because skipping it hands back the bodiless 200 for a resource nothing
   * authorized — the leak the guard exists to prevent, restored.
   */
  it('refuses to answer 200 when the authorization phase is missing', async () => {
    await expect(
      v2HeadAuthorizationResponse({
        useCase: { authorize: undefined },
        principal,
        input: { widgetId: 'widget-1', workspaceId: 'workspace-1' },
        request: headRequest(),
        errorPolicy: v2OrchestrationErrorPolicy,
      })
    ).rejects.toThrow(/authorize/)
  })
})

const presenterContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/widgets/[widgetId]/pages',
  params: z.object({ widgetId: z.string() }).strict(),
  query: z.object({ sort: z.string(), workspaceId: z.string() }).strict(),
  body: z.object({ value: z.string() }).strict(),
  response: {
    mode: 'json',
    status: 201,
    schema: z.object({
      data: z.object({ value: z.string() }),
      nextCursor: z.string(),
    }),
  },
})

/**
 * A `nextCursor` is stamped with the sort and filters the page was read under,
 * and those live in the request rather than the domain result — so a presenter
 * that cannot see the parsed request forces the use case to carry an HTTP
 * cursor-encoding concern back out.
 */
describe('defineV2JsonRoute presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt,
    })
    v2RouteMocks.operationRate.mockResolvedValue(allowedRate)
  })

  it('hands the presenter the parsed request alongside the result', async () => {
    const present = vi.fn((result: Result, parsed: ParsedRequest<typeof presenterContract>) => ({
      data: result,
      nextCursor: `${parsed.params.widgetId}:${parsed.query.sort}:${parsed.body.value}`,
    }))

    const handler = defineV2JsonRoute({
      contract: presenterContract,
      auth: v2ApiKeyAuth,
      operation,
      rateLimit: v2RateLimits.publicApi,
      errorPolicy: v2OrchestrationErrorPolicy,
      mapInput: ({ body }) => body,
      useCase: { operation, execute: async ({ input }) => input },
      present,
    })

    const response = await handler(
      new NextRequest('http://localhost/api/v2/widgets/widget-1/pages?sort=asc&workspaceId=ws-1', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'secret',
        },
        body: JSON.stringify({ value: 'ok' }),
      }),
      { params: Promise.resolve({ widgetId: 'widget-1' }) }
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      data: { value: 'ok' },
      nextCursor: 'widget-1:asc:ok',
    })
    expect(present).toHaveBeenCalledWith(
      { value: 'ok' },
      expect.objectContaining({
        params: { widgetId: 'widget-1' },
        query: { sort: 'asc', workspaceId: 'ws-1' },
        body: { value: 'ok' },
      })
    )
  })
})

describe('defineV2JsonRoute OAuth scope admission', () => {
  const oauthAuth = (scopes: readonly string[]) =>
    ({
      principal: {
        kind: 'oauth_access_token',
        userId: 'user-1',
        clientId: 'sim-cli',
        tokenId: 'token-1',
        scopes,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      rateLimitSubjectIds: ['oauth-token:token-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'oauth_access_token',
      keyExpiresAt: null,
    }) as unknown as V2ApiKeyAuthContext

  function bearerRequest(): NextRequest {
    return new NextRequest('http://localhost/api/v2/widgets', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sim_oat_x',
      },
      body: JSON.stringify({ value: 'ok' }),
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.preauthRate.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt,
    })
    v2RouteMocks.operationRate.mockResolvedValue(allowedRate)
  })

  it('refuses a read-only token on a semantic write before the use case runs', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(oauthAuth(['openid', 'api:read']))
    const execute = vi.fn()

    const response = await createHandler({ execute })(bearerRequest(), {
      params: undefined,
    })

    expect(response.status).toBe(403)
    expect(response.headers.get('www-authenticate')).toContain('insufficient_scope')
    expect(response.headers.get('www-authenticate')).toContain('api:write')
    expect(execute).not.toHaveBeenCalled()
  })

  it('admits the same token once the grant carries api:write', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(oauthAuth(['openid', 'api:read', 'api:write']))

    const response = await createHandler()(bearerRequest(), {
      params: undefined,
    })

    expect(response.status).toBe(201)
  })

  it('returns a bearer challenge when the token expires after authentication', async () => {
    const expiredAuth = oauthAuth(['api:write'])
    expiredAuth.principal = {
      ...expiredAuth.principal,
      expiresAt: new Date(0),
    } as V2ApiKeyAuthContext['principal']
    v2RouteMocks.authenticate.mockResolvedValue(expiredAuth)
    const execute = vi.fn()

    const response = await createHandler({ execute })(bearerRequest(), { params: undefined })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Bearer')
    expect(execute).not.toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).not.toHaveBeenCalled()
  })

  it('admits a read-only token on a semantic read using POST', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(oauthAuth(['openid', 'api:read']))
    const readOperation = { ...operation, oauthScope: 'api:read' } as const
    const handler = defineV2JsonRoute({
      contract,
      auth: v2ApiKeyAuth,
      operation: readOperation,
      rateLimit: v2RateLimits.publicApi,
      errorPolicy: v2OrchestrationErrorPolicy,
      mapInput: ({ body }) => body,
      useCase: { operation: readOperation, execute: async ({ input }) => input },
      present: (result) => ({ data: result }),
    })

    const response = await handler(bearerRequest(), { params: undefined })

    expect(response.status).toBe(201)
  })

  it('leaves an API-key principal alone, which carries no scopes at all', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)

    const response = await createHandler()(request(), { params: undefined })

    expect(response.status).toBe(201)
  })

  it('enforces write scope through raw-route admission', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(oauthAuth(['openid', 'api:read']))

    const admission = await admitV2Request(
      bearerRequest(),
      operation,
      v2ApiKeyAuth,
      v2RateLimits.publicApi
    )

    expect(admission.success).toBe(false)
    if (admission.success) throw new Error('Expected admission to fail')
    expect(admission.response.status).toBe(403)
    expect(admission.response.headers.get('www-authenticate')).toContain('api:write')
  })

  it('enforces write scope through optional raw-route admission when a credential is present', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(oauthAuth(['openid', 'api:read']))

    const admission = await admitOptionalV2Request(
      bearerRequest(),
      operation,
      v2ApiKeyAuth,
      v2RateLimits.publicApi
    )

    expect(admission.success).toBe(false)
    if (admission.success) throw new Error('Expected admission to fail')
    expect(admission.response.status).toBe(403)
    expect(admission.response.headers.get('www-authenticate')).toContain('api:write')
  })

  it('allows a semantic read through raw POST admission', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(oauthAuth(['openid', 'api:read']))

    const admission = await admitV2Request(
      bearerRequest(),
      { ...operation, oauthScope: 'api:read' },
      v2ApiKeyAuth,
      v2RateLimits.publicApi
    )

    expect(admission.success).toBe(true)
  })

  it('requires api:write for an effectful raw GET', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(oauthAuth(['openid', 'api:read']))
    const request = new NextRequest('http://localhost/api/v2/widgets', {
      headers: { authorization: 'Bearer sim_oat_x' },
    })

    const admission = await admitV2Request(request, operation, v2ApiKeyAuth, v2RateLimits.publicApi)

    expect(admission.success).toBe(false)
    if (admission.success) throw new Error('Expected admission to fail')
    expect(admission.response.headers.get('www-authenticate')).toContain('api:write')
  })
})
