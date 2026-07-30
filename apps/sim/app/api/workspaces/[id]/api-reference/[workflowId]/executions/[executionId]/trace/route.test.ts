/**
 * @vitest-environment node
 */
import { createMockRequest, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockIsFeatureEnabled, mockResolve, mockMaterialize } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockResolve: vi.fn(),
  mockMaterialize: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))
vi.mock('@/lib/workflows/api-reference', () => ({ resolveReadablePublication: mockResolve }))
vi.mock('@/lib/logs/execution/trace-store', () => ({ materializeExecutionData: mockMaterialize }))

import { GET } from '@/app/api/workspaces/[id]/api-reference/[workflowId]/executions/[executionId]/trace/route'

const PARAMS = { id: 'ws-A', workflowId: 'wf-1', executionId: 'exec-123' }

function call(params = PARAMS) {
  const request = createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost/api/workspaces/${params.id}/api-reference/${params.workflowId}/executions/${params.executionId}/trace`
  )
  return GET(request, { params: Promise.resolve(params) })
}

/** A stored execution-log row bound to this workflow + workspace. */
function logRow(overrides: Record<string, unknown> = {}) {
  return {
    executionId: 'exec-123',
    workflowId: 'wf-1',
    workspaceId: 'ws-A',
    status: 'completed',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    endedAt: new Date('2026-01-01T00:00:01Z'),
    totalDurationMs: 1000,
    executionData: { traceSpans: [] },
    ...overrides,
  }
}

describe('GET api-reference execution trace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetSession.mockResolvedValue({ user: { id: 'reader-1' } })
    mockMaterialize.mockResolvedValue({ spans: ['root'] })
    mockResolve.mockResolvedValue({
      workflowRow: { id: 'wf-1' },
      publication: { exposeTrace: 'traceId' },
      workspaceId: 'ws-A',
    })
    dbChainMockFns.limit.mockResolvedValue([logRow()])
  })

  it('returns the materialized trace for a matching execution when exposeTrace=traceId', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.executionId).toBe('exec-123')
    expect(body.trace).toEqual({ spans: ['root'] })
  })

  it('404 when exposeTrace is off', async () => {
    mockResolve.mockResolvedValue({
      workflowRow: { id: 'wf-1' },
      publication: { exposeTrace: 'off' },
      workspaceId: 'ws-A',
    })
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('404 when the execution belongs to a different workflow (no cross-caller reads)', async () => {
    dbChainMockFns.limit.mockResolvedValue([logRow({ workflowId: 'other-wf' })])
    const res = await call()
    expect(res.status).toBe(404)
    expect(mockMaterialize).not.toHaveBeenCalled()
  })

  it('404 when the execution id is unknown', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('404 when the publication is not readable', async () => {
    mockResolve.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(404)
  })
})
