/**
 * @vitest-environment node
 */

import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  order: [] as string[],
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { defineRouteContract } from '@/lib/api/contracts'
import { defineV2BodyLifecycleRoute } from '@/lib/api/server/routes/v2-body-lifecycle-route'
import { v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes/v2-json-route'
import { v2Error } from '@/app/api/v2/lib/response'

const operation = { id: 'test.body_lifecycle' } as const
const contract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/body-lifecycle/[id]',
  params: z.object({ id: z.string().min(1) }),
  query: z.object({ workspaceId: z.string().min(1) }),
  response: {
    mode: 'json',
    schema: z.object({ data: z.object({ id: z.string() }) }),
    status: 201,
  },
})

class StageRejection extends Error {}

type RejectableStage = 'admission' | 'body' | 'application' | 'presenter' | 'effects'

let rejectedStage: RejectableStage | null = null

function rejectAt(stage: RejectableStage): void {
  mocks.order.push(stage)
  if (rejectedStage === stage) throw new StageRejection(`${stage} rejected`)
}

function buildHandler() {
  return defineV2BodyLifecycleRoute({
    contract,
    auth: v2ApiKeyAuth,
    operation,
    rateLimit: v2RateLimits.publicApi,
    errorPolicy: {
      render(error) {
        return error instanceof StageRejection ? v2Error('CONFLICT', error.message) : null
      },
    },
    admission: {
      mapInput: ({ params, query }) => {
        mocks.order.push('contract')
        return { id: params.id, workspaceId: query.workspaceId }
      },
      useCase: {
        operation,
        async execute({ input }) {
          rejectAt('admission')
          return { canonicalWorkspaceId: input.workspaceId }
        },
      },
    },
    async readBody() {
      rejectAt('body')
      return { bytes: Buffer.from('body') }
    },
    mapInput: ({ parsed, admission }) => ({
      id: parsed.params.id,
      url: `stored://${admission.canonicalWorkspaceId}`,
    }),
    useCase: {
      operation,
      async execute({ input }) {
        rejectAt('application')
        return input
      },
    },
    present(result) {
      rejectAt('presenter')
      return { data: { id: result.id } }
    },
    onSuccess() {
      rejectAt('effects')
    },
  })
}

function buildRequest() {
  return new NextRequest('http://localhost/api/v2/body-lifecycle/item-1?workspaceId=workspace-1', {
    method: 'POST',
    headers: { 'x-api-key': 'secret' },
    body: 'unread-body',
  })
}

function context(id = 'item-1') {
  return { params: Promise.resolve({ id }) }
}

describe('defineV2BodyLifecycleRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.order.splice(0)
    rejectedStage = null
    v2RouteMocks.preauthRate.mockImplementation(async () => {
      mocks.order.push('ip-limit')
      return V2_PREAUTH_RATE_LIMIT_ALLOWED
    })
    v2RouteMocks.operationRate.mockImplementation(async () => {
      mocks.order.push('operation-limit')
      return V2_OPERATION_RATE_LIMIT_ALLOWED
    })
    v2RouteMocks.authenticate.mockImplementation(async () => {
      mocks.order.push('authenticate')
      return {
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
        rateLimitSubscription: null,
        keyType: 'personal',
      }
    })
  })

  it('fails fast when a contract body would be read before staged admission', () => {
    const bodyContract = defineRouteContract({
      method: 'POST',
      path: '/api/v2/body-lifecycle',
      body: z.object({ value: z.string() }),
      response: { mode: 'json', schema: z.object({ data: z.object({ id: z.string() }) }) },
    })
    const useCase = { operation, execute: async () => ({ id: 'item-1' }) }

    expect(() =>
      defineV2BodyLifecycleRoute({
        contract: bodyContract,
        auth: v2ApiKeyAuth,
        operation,
        rateLimit: v2RateLimits.publicApi,
        errorPolicy: { render: () => null },
        admission: { mapInput: () => ({}), useCase },
        readBody: async () => Buffer.alloc(0),
        mapInput: () => ({}),
        useCase,
        present: () => ({ data: { id: 'item-1' } }),
      })
    ).toThrow('must omit its body schema so admission precedes body reads')
  })

  it('runs admission, bounded body work, registration, presentation, and effects in order', async () => {
    const response = await buildHandler()(buildRequest(), context())

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ data: { id: 'item-1' } })
    expect(mocks.order).toEqual([
      'ip-limit',
      'authenticate',
      'operation-limit',
      'operation-limit',
      'contract',
      'admission',
      'body',
      'application',
      'presenter',
      'effects',
    ])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  /**
   * `v2InvalidBodyResponse` answers `415` when an unreadable body declared a
   * non-JSON media type, and `multipart/form-data` is exactly such a type. That
   * change is argued safe for this builder in prose — its contract must omit the
   * body schema, so `parseRequest` never attempts a JSON read and the
   * classification is unreachable — but nothing executed it. A multipart upload
   * is the shape this builder exists for, so it gets a test rather than a
   * paragraph.
   */
  it('accepts a multipart body, which the JSON builder would classify as 415', async () => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'data.bin')
    const request = new NextRequest(
      'http://localhost/api/v2/body-lifecycle/item-1?workspaceId=workspace-1',
      { method: 'POST', headers: { 'x-api-key': 'secret' }, body: form }
    )
    expect(request.headers.get('content-type')).toContain('multipart/form-data')

    const response = await buildHandler()(request, context())

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ data: { id: 'item-1' } })
    expect(mocks.order).toContain('body')
  })

  it('rejects at the IP abuse limit before authentication', async () => {
    v2RouteMocks.preauthRate.mockImplementation(async () => {
      mocks.order.push('ip-limit')
      return { ...V2_PREAUTH_RATE_LIMIT_ALLOWED, allowed: false, remaining: 0 }
    })

    const response = await buildHandler()(buildRequest(), context())

    expect(response.status).toBe(429)
    expect(mocks.order).toEqual(['ip-limit'])
  })

  it('rejects unauthenticated requests before operation limiting', async () => {
    v2RouteMocks.authenticate.mockImplementation(async () => {
      mocks.order.push('authenticate')
      throw new MockV2ApiKeyUnauthenticatedError('Authentication required')
    })

    const response = await buildHandler()(buildRequest(), context())

    expect(response.status).toBe(401)
    expect(mocks.order).toEqual(['ip-limit', 'authenticate'])
  })

  it('rejects operation-limited requests before contract or application admission', async () => {
    v2RouteMocks.operationRate.mockImplementation(async () => {
      mocks.order.push('operation-limit')
      return { ...V2_OPERATION_RATE_LIMIT_ALLOWED, allowed: false, remaining: 0 }
    })

    const response = await buildHandler()(buildRequest(), context())

    expect(response.status).toBe(429)
    expect(mocks.order).toEqual(['ip-limit', 'authenticate', 'operation-limit', 'operation-limit'])
  })

  it('rejects invalid contract input before application admission or body reads', async () => {
    const response = await buildHandler()(buildRequest(), context(''))

    expect(response.status).toBe(400)
    expect(mocks.order).toEqual(['ip-limit', 'authenticate', 'operation-limit', 'operation-limit'])
  })

  it.each<RejectableStage>(['admission', 'body', 'application', 'presenter', 'effects'])(
    'renders typed %s rejection without entering later phases',
    async (stage) => {
      rejectedStage = stage

      const response = await buildHandler()(buildRequest(), context())

      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({
        error: { code: 'CONFLICT', message: `${stage} rejected` },
      })
      expect(mocks.order.at(-1)).toBe(stage)
    }
  )

  it.each(['authentication', 'rate_limit'] as const)(
    'maps %s infrastructure failures to service unavailable',
    async (stage) => {
      const failure = new Error(`${stage} unavailable`)
      if (stage === 'authentication') v2RouteMocks.authenticate.mockRejectedValue(failure)
      if (stage === 'rate_limit') v2RouteMocks.operationRate.mockRejectedValue(failure)

      const response = await buildHandler()(buildRequest(), context())

      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
      })
    }
  )
})
