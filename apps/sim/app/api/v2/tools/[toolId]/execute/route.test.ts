/**
 * @vitest-environment node
 */
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

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
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
    vi.clearAllMocks()
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

  it('returns the tool result in the v2 envelope', async () => {
    const response = await post({ workspaceId: WORKSPACE_ID, input: { url: 'https://a.example' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      data: {
        toolId: 'firecrawl_scrape',
        status: 'succeeded',
        output: { markdown: '# Hi' },
        error: null,
      },
    })
  })

  it('defaults the arguments so a no-input tool needs no body field', async () => {
    await post({ workspaceId: WORKSPACE_ID })

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ input: {} }) })
    )
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

  it('names a denied integration in the 403 so a client can branch on it', async () => {
    mocks.execute.mockRejectedValue(
      new ForbiddenOperationError('INTEGRATION_NOT_ALLOWED', 'firecrawl_scrape is not permitted')
    )

    const response = await post({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.code).toBe('FORBIDDEN')
    expect(body.error.details.code).toBe('INTEGRATION_NOT_ALLOWED')
  })

  it('conceals an unknown tool as absent', async () => {
    mocks.execute.mockRejectedValue(new OrchestrationError('not_found', 'Tool not found'))

    const response = await post({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('rejects an unknown body field rather than dropping it', async () => {
    const response = await post({ workspaceId: WORKSPACE_ID, params: { url: 'https://a.example' } })

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects a timeout beyond the ceiling', async () => {
    const response = await post({ workspaceId: WORKSPACE_ID, timeoutSeconds: 100_000 })

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('timeoutSeconds')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
