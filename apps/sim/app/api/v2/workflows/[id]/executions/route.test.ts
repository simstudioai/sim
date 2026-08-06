/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveV2WorkflowAccess } = vi.hoisted(() => ({
  mockResolveV2WorkflowAccess: vi.fn(),
}))

vi.mock('@/app/api/v2/workflows/lib/access', () => ({
  resolveV2WorkflowAccess: mockResolveV2WorkflowAccess,
}))

import { GET } from '@/app/api/v2/workflows/[id]/executions/route'

const routeContext = () => ({ params: Promise.resolve({ id: 'workflow-1' }) })
const callGet = (query = '') =>
  GET(
    new NextRequest(`http://localhost:3000/api/v2/workflows/workflow-1/executions${query}`),
    routeContext()
  )

const EXECUTIONS = [
  {
    rowId: 'row-2',
    executionId: 'execution-2',
    workflowId: 'workflow-1',
    status: 'paused',
    trigger: 'api',
    startedAt: new Date('2026-08-05T00:02:00Z'),
    endedAt: null,
    durationMs: null,
    costTotal: '0.02',
  },
  {
    rowId: 'row-1',
    executionId: 'execution-1',
    workflowId: 'workflow-1',
    status: 'completed',
    trigger: 'schedule',
    startedAt: new Date('2026-08-05T00:01:00Z'),
    endedAt: new Date('2026-08-05T00:01:03Z'),
    durationMs: 3000,
    costTotal: null,
  },
]

describe('GET /api/v2/workflows/[id]/executions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveV2WorkflowAccess.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      keyType: 'workspace',
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })
    dbChainMockFns.limit.mockResolvedValue(EXECUTIONS)
  })

  it('lists lightweight execution resources in the cursor envelope', async () => {
    const response = await callGet()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.nextCursor).toBeNull()
    expect(body.data).toEqual([
      {
        executionId: 'execution-2',
        workflowId: 'workflow-1',
        status: 'paused',
        trigger: 'api',
        startedAt: '2026-08-05T00:02:00.000Z',
        endedAt: null,
        durationMs: null,
        cost: { total: 0.02 },
      },
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        status: 'completed',
        trigger: 'schedule',
        startedAt: '2026-08-05T00:01:00.000Z',
        endedAt: '2026-08-05T00:01:03.000Z',
        durationMs: 3000,
        cost: null,
      },
    ])
  })

  it('returns an opaque cursor when another row exists', async () => {
    dbChainMockFns.limit.mockResolvedValue([...EXECUTIONS, { ...EXECUTIONS[1], rowId: 'row-0' }])

    const body = await (await callGet('?limit=2')).json()

    expect(body.data).toHaveLength(2)
    expect(body.nextCursor).toEqual(expect.any(String))
    expect(JSON.parse(Buffer.from(body.nextCursor, 'base64').toString())).toEqual({
      sort: 'startedAt:desc',
      keys: ['2026-08-05T00:01:00.000Z', 'row-1'],
    })
  })

  it('rejects an invalid cursor', async () => {
    const response = await callGet('?cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('rejects a cursor minted under a different order', async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        sort: 'startedAt:desc',
        keys: ['2026-08-05T00:01:00.000Z', 'row-1'],
      })
    ).toString('base64')

    const response = await callGet(`?order=asc&cursor=${encodeURIComponent(cursor)}`)

    expect(response.status).toBe(400)
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('rejects queued as a durable-history filter', async () => {
    const response = await callGet('?status=queued')

    expect(response.status).toBe(400)
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('authorizes the workflow before validating filters', async () => {
    mockResolveV2WorkflowAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 404 }),
    })

    const response = await callGet('?limit=0')

    expect(response.status).toBe(404)
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })
})
