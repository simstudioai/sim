import { createMockRequest } from '@sim/testing'
import { apiServerRoutesMock } from '@sim/testing/mocks/api-server-routes.mock'
import { describe, expect, it, vi } from 'vitest'

const mocks = await vi.hoisted(async () => {
  const state = {
    status: 200,
    errorPolicy: undefined as
      | {
          project(error: unknown): { body: unknown; status: number; headers?: HeadersInit } | null
          unhandled?(): { body: unknown; status: number; headers?: HeadersInit }
        }
      | undefined,
  }
  const { apiServerRoutesMockFns } = await import('@sim/testing/mocks/api-server-routes.mock')
  apiServerRoutesMockFns.mockDefineInternalJsonRoute.mockImplementation(
    (options: { errorPolicy: typeof state.errorPolicy; staticResponseHeaders?: HeadersInit }) => {
      state.errorPolicy = options.errorPolicy
      return async () =>
        new Response(JSON.stringify({ ok: state.status < 400 }), {
          status: state.status,
          headers: options.staticResponseHeaders,
        })
    }
  )
  return state
})

vi.mock('@/lib/api/server/routes', () => apiServerRoutesMock)

import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { POST } from '@/app/api/selectors/execute/route'
import { IntegrationNotAllowedError } from '@/ee/access-control/utils/permission-check'

function project(error: unknown) {
  const result = mocks.errorPolicy?.project(error)
  if (!result) throw new Error('Expected route error policy to project the error')
  return result
}

describe('POST /api/selectors/execute', () => {
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

  /**
   * The one selector failure that names itself. The other three are normalized
   * so a caller cannot probe a scope or a credential through them; this one
   * reports the caller's own permission group against their own workspace and
   * names the remedy, which "Connection unavailable" would hide.
   */
  it('projects an integration-allowlist refusal as its own 403', () => {
    expect(project(new IntegrationNotAllowedError('gmail_v2'))).toEqual({
      status: 403,
      body: {
        error: 'Integration "gmail_v2" is not allowed based on your permission group settings',
      },
      headers: { 'Cache-Control': 'private, no-store' },
    })
  })
})
