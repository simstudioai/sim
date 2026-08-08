/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  authenticate: vi.fn(),
  checkPreAuth: vi.fn(),
  checkRateLimit: vi.fn(),
  gate: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: (...args: unknown[]) => {
    mocks.order.push('authenticate')
    return mocks.authenticate(...args)
  },
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect(...args: unknown[]) {
      mocks.order.push('ip-limit')
      return mocks.checkPreAuth(...args)
    }

    checkRateLimitDirectOrThrow(...args: unknown[]) {
      mocks.order.push('operation-limit')
      return mocks.checkRateLimit(...args)
    }
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: (...args: unknown[]) => {
    mocks.order.push('rollout')
    return mocks.gate(...args)
  },
}))

import { defineRouteContract } from '@/lib/api/contracts'
import { V2ApiKeyUnauthenticatedError } from '@/lib/api/server/routes/v2-api-key-auth'
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

const RATE_LIMIT_OK = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 0,
}

class StageRejection extends Error {}

type RejectableStage = 'admission' | 'body' | 'transfer' | 'application' | 'presenter' | 'effects'

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
    async transfer({ admission }) {
      rejectAt('transfer')
      return { url: `stored://${admission.canonicalWorkspaceId}` }
    },
    mapInput: ({ parsed, transfer }) => ({ id: parsed.params.id, url: transfer.url }),
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
    mocks.checkPreAuth.mockResolvedValue(RATE_LIMIT_OK)
    mocks.checkRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.authenticate.mockResolvedValue({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rolloutUserId: 'user-1',
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
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
        transfer: async () => ({ url: 'stored://item-1' }),
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
      'rollout',
      'operation-limit',
      'operation-limit',
      'contract',
      'admission',
      'body',
      'transfer',
      'application',
      'presenter',
      'effects',
    ])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('rejects at the IP abuse limit before authentication', async () => {
    mocks.checkPreAuth.mockResolvedValue({ ...RATE_LIMIT_OK, allowed: false, remaining: 0 })

    const response = await buildHandler()(buildRequest(), context())

    expect(response.status).toBe(429)
    expect(mocks.order).toEqual(['ip-limit'])
  })

  it('rejects unauthenticated requests before rollout and operation limiting', async () => {
    mocks.authenticate.mockRejectedValue(
      new V2ApiKeyUnauthenticatedError('Authentication required')
    )

    const response = await buildHandler()(buildRequest(), context())

    expect(response.status).toBe(401)
    expect(mocks.order).toEqual(['ip-limit', 'authenticate'])
  })

  it('rejects rollout-gated requests before operation limiting', async () => {
    mocks.gate.mockResolvedValue(v2Error('FORBIDDEN', 'V2 API access is not enabled'))

    const response = await buildHandler()(buildRequest(), context())

    expect(response.status).toBe(403)
    expect(mocks.order).toEqual(['ip-limit', 'authenticate', 'rollout'])
  })

  it('rejects operation-limited requests before contract or application admission', async () => {
    mocks.checkRateLimit.mockResolvedValue({ ...RATE_LIMIT_OK, allowed: false, remaining: 0 })

    const response = await buildHandler()(buildRequest(), context())

    expect(response.status).toBe(429)
    expect(mocks.order).toEqual([
      'ip-limit',
      'authenticate',
      'rollout',
      'operation-limit',
      'operation-limit',
    ])
  })

  it('rejects invalid contract input before application admission or body reads', async () => {
    const response = await buildHandler()(buildRequest(), context(''))

    expect(response.status).toBe(400)
    expect(mocks.order).toEqual([
      'ip-limit',
      'authenticate',
      'rollout',
      'operation-limit',
      'operation-limit',
    ])
  })

  it.each<RejectableStage>([
    'admission',
    'body',
    'transfer',
    'application',
    'presenter',
    'effects',
  ])('renders typed %s rejection without entering later phases', async (stage) => {
    rejectedStage = stage

    const response = await buildHandler()(buildRequest(), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: { code: 'CONFLICT', message: `${stage} rejected` },
    })
    expect(mocks.order.at(-1)).toBe(stage)
  })

  it.each(['authentication', 'rollout', 'rate_limit'] as const)(
    'maps %s infrastructure failures to service unavailable',
    async (stage) => {
      const failure = new Error(`${stage} unavailable`)
      if (stage === 'authentication') mocks.authenticate.mockRejectedValue(failure)
      if (stage === 'rollout') mocks.gate.mockRejectedValue(failure)
      if (stage === 'rate_limit') mocks.checkRateLimit.mockRejectedValue(failure)

      const response = await buildHandler()(buildRequest(), context())

      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
      })
    }
  )
})
