/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: 200,
  userRateLimit: vi.fn(() => ({ kind: 'user' as const })),
  errorPolicy: undefined as
    | {
        project(error: unknown): { body: unknown; status: number; headers?: HeadersInit } | null
        unhandled?(): { body: unknown; status: number; headers?: HeadersInit }
      }
    | undefined,
}))

vi.mock('@/lib/api/server/routes', () => {
  const internalErrorResponse = vi.fn((status: number, body: unknown, headers?: HeadersInit) => ({
    body,
    status,
    headers,
  }))
  const internalOrchestrationErrorPolicy = {
    project(error: unknown) {
      if (!(error instanceof Error) || !('code' in error)) return null
      const code = (error as Error & { code: string }).code
      const status =
        code === 'validation'
          ? 400
          : code === 'unauthorized'
            ? 401
            : code === 'forbidden'
              ? 403
              : code === 'not_found'
                ? 404
                : code === 'conflict'
                  ? 409
                  : 500
      return internalErrorResponse(status, { error: error.message })
    },
    unhandled: () => internalErrorResponse(500, { error: 'Internal server error' }),
  }

  return {
    defineInternalJsonRoute: vi.fn(
      (options: { errorPolicy: typeof mocks.errorPolicy; staticResponseHeaders?: HeadersInit }) => {
        mocks.errorPolicy = options.errorPolicy
        return async () =>
          new Response(JSON.stringify({ ok: mocks.status < 400 }), {
            status: mocks.status,
            headers: options.staticResponseHeaders,
          })
      }
    ),
    extendInternalErrorPolicy: vi.fn(
      (
        base: typeof internalOrchestrationErrorPolicy,
        project: (error: unknown) => ReturnType<typeof internalErrorResponse> | null
      ) => ({
        project: (error: unknown) => project(error) ?? base.project(error),
        unhandled: base.unhandled,
      })
    ),
    internalErrorResponse,
    internalOrchestrationErrorPolicy,
    internalRateLimits: { user: mocks.userRateLimit },
    internalSessionAuth: {},
  }
})

import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { POST } from '@/app/api/selectors/execute/route'

function project(error: unknown) {
  const result = mocks.errorPolicy?.project(error)
  if (!result) throw new Error('Expected route error policy to project the error')
  return result
}

describe('POST /api/selectors/execute', () => {
  it('uses authenticated per-user admission control', () => {
    expect(mocks.userRateLimit).toHaveBeenCalledWith({ bucketName: 'selectors.execute' })
  })

  it('marks success, authentication, parse, and unhandled responses private and non-cacheable', async () => {
    for (const status of [200, 400, 401, 500]) {
      mocks.status = status
      const response = await POST(createMockRequest('POST', {}))

      expect(response.status).toBe(status)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    }
  })

  it.each([
    ['missing workflow', new OrchestrationError('not_found', 'Workflow not found')],
    ['missing workspace', new OrchestrationError('not_found', 'Workspace not found')],
    ['asserted workspace mismatch', new OrchestrationError('not_found', 'Workflow not found')],
    ['cross-tenant workspace', new NoWorkspaceAccessError()],
  ])('conceals %s as the same selector-scope absence', (_case, error) => {
    expect(project(error)).toEqual({
      status: 404,
      body: { error: 'Selector scope not found' },
      headers: { 'Cache-Control': 'private, no-store' },
    })
  })

  it.each([
    [new SelectorContextUnavailableError(), 400, 'Context unavailable'],
    [new SelectorConnectionUnavailableError(), 403, 'Connection unavailable'],
    [new SelectorConnectionUnavailableError(401), 401, 'Connection unavailable'],
    [new SelectorOptionsUnavailableError(), 502, 'Options unavailable'],
    [new SelectorOptionsUnavailableError(429), 429, 'Options temporarily unavailable'],
  ])('preserves selector error projection for %s', (error, status, message) => {
    expect(project(error)).toEqual({
      status,
      body: { error: message },
      headers: { 'Cache-Control': 'private, no-store' },
    })
  })

  it('preserves same-workspace forbidden errors', () => {
    expect(
      project(new OrchestrationError('forbidden', 'Insufficient workspace permissions'))
    ).toEqual({
      status: 403,
      body: { error: 'Insufficient workspace permissions' },
      headers: undefined,
    })
  })
})
