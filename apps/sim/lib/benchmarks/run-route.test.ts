import { createDeferred } from '@sim/testing/helpers/deferred'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { DEFAULT_BENCHMARK_EVALUATOR, DEFAULT_BENCHMARK_PLANNER } from '@/lib/benchmarks/models'
import { readBenchmarkRunResponse } from '@/lib/benchmarks/run-stream'
import { emptyBenchmarkArtifacts } from '@/lib/benchmarks/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), gate: vi.fn() }))
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
vi.mock('@/lib/benchmarks/application/access', () => ({ requireBenchmarkOperator: mocks.gate }))
vi.mock('@/lib/benchmarks/application/run-stage', () => ({
  runBenchmarkStage: {
    get operation() {
      return benchmarkOperations.run
    },
    execute: mocks.execute,
  },
}))
vi.mock('@/lib/benchmarks/application/run-comparison', () => ({
  runBenchmarkComparison: {
    get operation() {
      return benchmarkOperations.compare
    },
    execute: mocks.execute,
  },
}))

import { POST as compare } from '@/app/api/organizations/[id]/benchmarks/[benchmarkId]/compare/route'
import { POST as stage } from '@/app/api/organizations/[id]/benchmarks/[benchmarkId]/run/route'

const result = {
  benchmark: {
    id: 'benchmark',
    organizationId: 'org',
    userId: 'operator',
    runAsUserId: 'target',
    sourceWorkspaceId: '00000000-0000-4000-8000-000000000001',
    name: 'Fixture',
    version: 2,
    runningStage: null,
    attemptId: null,
    leaseExpiresAt: null,
    plannerChatId: null,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    artifacts: emptyBenchmarkArtifacts(),
  },
}
const cases = [
  { name: 'stage', handler: stage, body: { version: 1, stage: 'plan' } },
  {
    name: 'comparison',
    handler: compare,
    body: {
      version: 1,
      planners: [DEFAULT_BENCHMARK_PLANNER],
      evaluator: DEFAULT_BENCHMARK_EVALUATOR,
    },
  },
]
beforeEach(() => {
  vi.useFakeTimers()
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'operator' },
    session: { id: 'session' },
  })
  mocks.gate.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())
it.each(cases)(
  '$name sends heartbeats while work is pending beyond proxy idle time',
  async ({ handler, body }) => {
    const work = createDeferred<typeof result>()
    mocks.execute.mockReturnValueOnce(work.promise)
    let response: Response | undefined
    const request = handler(createMockRequest('POST', body), {
      params: Promise.resolve({ id: 'org', benchmarkId: 'benchmark' }),
    }).then((value) => {
      response = value
      return value
    })
    try {
      await vi.advanceTimersByTimeAsync(1)
      expect(response?.headers.get('content-type')).toContain('application/x-ndjson')
      if (!response?.body) throw new Error('Missing benchmark response stream')
      const reader = response.body.getReader()
      expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toMatchObject({
        type: 'heartbeat',
      })
      for (let index = 0; index < 5; index++) {
        await vi.advanceTimersByTimeAsync(15_000)
        expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toMatchObject({
          type: 'heartbeat',
        })
      }
      work.resolve(result)
      expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toMatchObject({
        type: 'result',
        benchmark: { id: 'benchmark' },
      })
      expect((await reader.read()).done).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      work.resolve(result)
      await request
    }
  }
)
it.each(cases)(
  '$name rejects anonymous requests before executing work',
  async ({ handler, body }) => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const response = await handler(createMockRequest('POST', body), {
      params: Promise.resolve({ id: 'org', benchmarkId: 'benchmark' }),
    })
    expect(response.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  }
)

it('cancels the running stage and heartbeat when its response reader disconnects', async () => {
  const work = createDeferred<typeof result>()
  mocks.execute.mockReturnValueOnce(work.promise)
  const response = await stage(createMockRequest('POST', { version: 1, stage: 'plan' }), {
    params: { id: 'org', benchmarkId: 'benchmark' },
  })
  if (!response.body) throw new Error('Missing benchmark response stream')
  const reader = response.body.getReader()
  await reader.read()
  try {
    await expect(reader.cancel()).resolves.toBeUndefined()
    expect(mocks.execute.mock.calls[0][0].request.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    work.resolve(result)
    await vi.advanceTimersByTimeAsync(1)
  }
})
it.each([
  {
    error: new OrchestrationError('conflict', 'Version changed'),
    status: 409,
    message: 'Version changed',
  },
  {
    error: new Error('private internal driver details'),
    status: 500,
    message: 'Benchmark run failed',
  },
])(
  'preserves safe terminal errors after the response has started ($status)',
  async ({ error, status, message }) => {
    mocks.execute.mockRejectedValueOnce(error)
    const response = await stage(createMockRequest('POST', { version: 1, stage: 'plan' }), {
      params: { id: 'org', benchmarkId: 'benchmark' },
    })
    await expect(readBenchmarkRunResponse(response)).rejects.toMatchObject({ status, message })
    expect(vi.getTimerCount()).toBe(0)
  }
)
it('does not treat an incomplete heartbeat-only stream as a completed benchmark', async () => {
  await expect(readBenchmarkRunResponse(new Response('{"type":"heartbeat"}\n'))).rejects.toThrow(
    'ended before a result'
  )
})
it('parses a terminal result split across UTF-8 chunks', async () => {
  const expected = { benchmark: { ...result.benchmark, name: '界 fixture' } }
  const bytes = new TextEncoder().encode(`${JSON.stringify({ type: 'result', ...expected })}\n`)
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 2)
          controller.enqueue(bytes.slice(offset, offset + 2))
        controller.close()
      },
    })
  )
  expect(await readBenchmarkRunResponse(response)).toEqual(expected)
})

it('rejects a throttled benchmark before running paid work or parsing its body', async () => {
  rateLimiterMockFns.mockEnforceUserRateLimit.mockResolvedValueOnce(
    new Response('Throttled', { status: 429 })
  )
  const response = await stage(createMockRequest('POST', { invalid: true }), {
    params: { id: 'org', benchmarkId: 'benchmark' },
  })
  expect(response.status).toBe(429)
  expect(mocks.gate).not.toHaveBeenCalled()
  expect(mocks.execute).not.toHaveBeenCalled()
})

it.each(cases)(
  '$name rejects an ineligible operator before parsing the request',
  async ({ handler }) => {
    mocks.gate.mockRejectedValueOnce(new OrchestrationError('not_found', 'Not found'))
    const response = await handler(createMockRequest('POST', { invalid: true }), {
      params: { id: 'org', benchmarkId: 'benchmark' },
    })
    expect(response.status).toBe(404)
    expect(mocks.execute).not.toHaveBeenCalled()
  }
)
