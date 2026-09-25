import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/tool-execution/application/execute-tool', () => ({
  executeToolForCaller: { operation: { id: 'tools.execute' }, execute: mocks.execute },
}))

import { POST } from '@/app/api/v2/tools/[toolId]/execute/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

function request(body: unknown, toolId = 'firecrawl_scrape') {
  return {
    request: new NextRequest(`http://localhost:3000/api/v2/tools/${toolId}/execute`, {
      method: 'POST',
      headers: { 'x-api-key': 'key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context: { params: Promise.resolve({ toolId }) },
  }
}

function post(body: unknown, toolId?: string) {
  const { request: req, context } = request(body, toolId)
  return POST(req, context)
}

describe('POST /api/v2/tools/{toolId}/execute', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      toolId: 'firecrawl_scrape',
      status: 'succeeded',
      output: { markdown: '# Hi' },
      error: null,
    })
  })

  /**
   * The API call worked; the third party refused. Answering `4xx` here would
   * tell a client its own request was wrong, which it was not.
   */
  it('answers 200 for a tool that ran and refused', async () => {
    mocks.execute.mockResolvedValue({
      toolId: 'firecrawl_scrape',
      status: 'failed',
      output: {},
      error: { message: 'Firecrawl returned 402' },
    })

    const response = await post({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.status).toBe('failed')
    expect(body.data.error.message).toBe('Firecrawl returned 402')
  })

  it('rejects a timeout beyond the ceiling', async () => {
    const response = await post({ workspaceId: WORKSPACE_ID, timeoutSeconds: 100_000 })

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('timeoutSeconds')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
