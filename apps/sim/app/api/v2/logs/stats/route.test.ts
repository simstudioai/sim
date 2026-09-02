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

vi.mock('@/lib/logs/application/get-log-stats', () => ({
  getLogStats: { operation: { id: 'logs.read_stats' }, execute: mocks.execute },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/logs/stats/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const segment = {
  timestamp: '2026-08-06T00:00:00.000Z',
  totalExecutions: 2,
  successfulExecutions: 1,
  avgDurationMs: 500,
}

const stats = {
  workflows: [
    {
      workflowId: 'workflow-1',
      workflowName: 'Support Agent',
      segments: [segment],
      totalExecutions: 2,
      totalSuccessful: 1,
      overallSuccessRate: 50,
    },
  ],
  aggregateSegments: [segment],
  totalRuns: 2,
  totalErrors: 1,
  avgLatency: 500,
  timeBounds: { start: '2026-08-06T00:00:00.000Z', end: '2026-08-06T01:00:00.000Z' },
  segmentMs: 3_600_000,
}

function request(query = ''): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/v2/logs/stats?workspaceId=${WORKSPACE_ID}${query}`
  )
}

describe('GET /api/v2/logs/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({ stats, workflowsTruncated: false })
  })

  it('returns the aggregate under the v2 envelope with the truncation flag', async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ...stats, workflowsTruncated: false } })
  })

  it('defaults the bucket count without the caller naming one', async () => {
    await GET(request())

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ segmentCount: 72 }) })
    )
  })

  it('omits empty buckets by default and forwards an explicit includeEmpty', async () => {
    await GET(request())
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ includeEmpty: false }) })
    )

    await GET(request('&includeEmpty=true'))
    expect(mocks.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ includeEmpty: true }) })
    )
  })

  it('rejects an includeEmpty spelling outside the published vocabulary', async () => {
    const response = await GET(request('&includeEmpty=maybe'))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('expected one of') },
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  /**
   * Each of these produced a 500 before the bounds landed: `0` divided by zero,
   * `1e9` allocated two billion-element arrays, and a fraction indexed between
   * buckets. A caller-supplied value must never reach the aggregator unbounded.
   */
  it.each([['0'], ['1.5'], ['1e9'], ['-1'], ['501']])(
    'rejects segmentCount=%s before any protected read',
    async (value) => {
      const response = await GET(request(`&segmentCount=${encodeURIComponent(value)}`))

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: 'BAD_REQUEST', message: expect.stringContaining('segmentCount') },
      })
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it('rejects an unknown query param instead of silently ignoring it', async () => {
    const response = await GET(request('&bogus=1'))

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('parses filter lists once, into the values the query filters on', async () => {
    await GET(request('&workflowIds=b,a,a&triggers=api&folderPaths=/prod'))

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          filters: expect.objectContaining({ workflowIds: ['a', 'b'], triggers: ['api'] }),
          folderPaths: ['/prod'],
        }),
      })
    )
  })

  it('conceals a workspace the caller cannot reach', async () => {
    mocks.execute.mockRejectedValueOnce(new OrchestrationError('not_found', 'Workspace not found'))

    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('carries the per-caller cache directive every v2 response needs', async () => {
    const response = await GET(request())

    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
