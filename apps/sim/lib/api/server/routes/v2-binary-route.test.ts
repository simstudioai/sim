/**
 * @vitest-environment node
 */
import type { PersonalApiKeyPrincipal } from '@sim/auth/principal'
import { v2ApiKeyAuthModuleMock, v2RateLimiterModuleMock, v2RouteMocks } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { NoWorkspaceAccessError, type OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { v2ApiKeyAuth, v2OrchestrationErrorPolicy, v2RateLimits } from '@/lib/api/server/routes'
import type { V2ApiKeyAuthContext } from '@/lib/api/server/routes/v2-api-key-auth'
import { defineV2BinaryRoute } from '@/lib/api/server/routes/v2-binary-route'

const operation = { id: 'widgets.download' } as const
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
} satisfies V2ApiKeyAuthContext
const resetAt = new Date('2026-08-08T20:00:00.000Z')
const allowedRate = { allowed: true, remaining: 99, resetAt }

const contract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/widgets/[widgetId]',
  params: z.object({ widgetId: z.string() }),
  query: z.object({ workspaceId: z.string().min(1) }).strict(),
  response: { mode: 'binary' },
})

interface Input {
  widgetId: string
}

interface Result {
  bytes: string
}

function createHandler(options: {
  headSafe?: boolean
  execute: () => Promise<Result>
  authorize?: () => Promise<void>
  omitAuthorize?: boolean
}) {
  const useCase: OperationUseCase<typeof operation, Input, Result> = {
    operation,
    execute: options.execute,
    authorize: options.omitAuthorize ? undefined : (options.authorize ?? (async () => {})),
  }
  return defineV2BinaryRoute({
    contract,
    auth: v2ApiKeyAuth,
    operation,
    headSafe: options.headSafe,
    rateLimit: v2RateLimits.publicApi,
    errorPolicy: v2OrchestrationErrorPolicy,
    mapInput: ({ params }) => params,
    useCase,
    present: (result) => ({ body: result.bytes, contentType: 'application/octet-stream' }),
  })
}

function request(method: 'GET' | 'HEAD', query = 'workspaceId=workspace-1'): NextRequest {
  return new NextRequest(`http://localhost/api/v2/widgets/widget-1?${query}`, {
    method,
    headers: { 'x-api-key': 'secret' },
  })
}

const context = { params: Promise.resolve({ widgetId: 'widget-1' }) }

describe('defineV2BinaryRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue({ allowed: true, remaining: 599, resetAt })
    v2RouteMocks.operationRate.mockResolvedValue(allowedRate)
  })

  it('streams the descriptor on GET', async () => {
    const execute = vi.fn(async () => ({ bytes: 'payload' }))
    const response = await createHandler({ execute })(request('GET'), context)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('payload')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('runs the use case for a HEAD when the route is head-safe', async () => {
    const execute = vi.fn(async () => ({ bytes: 'payload' }))
    const response = await createHandler({ execute })(request('HEAD'), context)

    expect(response.status).toBe(200)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('answers a HEAD bodiless without executing when the route is not head-safe', async () => {
    const execute = vi.fn(async () => ({ bytes: 'payload' }))
    const response = await createHandler({ headSafe: false, execute })(request('HEAD'), context)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(execute).not.toHaveBeenCalled()
  })

  it('still authenticates and rate-limits a HEAD on a route that is not head-safe', async () => {
    const execute = vi.fn(async () => ({ bytes: 'payload' }))
    const handler = createHandler({ headSafe: false, execute })

    await handler(request('HEAD'), context)

    expect(v2RouteMocks.authenticate).toHaveBeenCalledOnce()
    expect(v2RouteMocks.operationRate).toHaveBeenCalled()
  })

  /**
   * A download `HEAD` answered from admission alone lets any valid API key
   * enumerate file ids across every workspace, while the `GET` beside it answers
   * 403. Running the use case's authorization phase and rendering the refusal
   * through the route's error policy keeps the probe from saying more than the
   * download would.
   */
  it('answers a denied HEAD with the status its GET would produce', async () => {
    const execute = vi.fn(async () => ({ bytes: 'payload' }))
    const response = await createHandler({
      headSafe: false,
      execute,
      authorize: async () => {
        throw new NoWorkspaceAccessError()
      },
    })(request('HEAD'), context)

    expect(response.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  it('answers a HEAD for a nonexistent resource with 404, not 200', async () => {
    const execute = vi.fn(async () => ({ bytes: 'payload' }))
    const response = await createHandler({
      headSafe: false,
      execute,
      authorize: async () => {
        throw new OrchestrationError('not_found', 'Widget not found')
      },
    })(request('HEAD'), context)

    expect(response.status).toBe(404)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects a HEAD missing a required param instead of answering 200', async () => {
    const execute = vi.fn(async () => ({ bytes: 'payload' }))
    const authorize = vi.fn(async () => {})
    const response = await createHandler({ headSafe: false, execute, authorize })(
      request('HEAD', ''),
      context
    )

    expect(response.status).toBe(400)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('refuses at definition time to build a not-head-safe route that cannot authorize', () => {
    expect(() =>
      createHandler({ headSafe: false, omitAuthorize: true, execute: async () => ({ bytes: '' }) })
    ).toThrow(/authorize/)
  })
})
