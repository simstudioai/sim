import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import {
  tableApplicationRowsMock,
  tableApplicationRowsMockFns,
} from '@sim/testing/mocks/table-application-rows.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  startRun: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)
vi.mock('@/lib/table/application/runs', () => ({
  startTableRun: { operation: { id: 'tables.runs.start' }, execute: mocks.startRun },
}))

import { GET } from '@/app/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]/route'

const { mockReadTableRowEnrichmentDetail } = tableApplicationRowsMockFns

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

describe('GET /api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]', () => {
  const DETAIL = {
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:02.000Z',
    durationMs: 2000,
    totalCost: 0.02,
    matchedProvider: 'hunter',
    aborted: false,
    providers: [
      {
        id: 'hunter',
        label: 'Hunter',
        toolId: 'hunter_find_email',
        status: 'matched' as const,
        cost: 0.02,
        durationMs: 2000,
        error: null,
      },
    ],
  }

  const TABLE = {
    id: 'table-1',
    schema: {
      columns: [
        { id: 'col-email', name: 'email', type: 'text' },
        { id: 'col-name', name: 'name', type: 'text' },
        { id: 'col-title', name: 'title', type: 'text' },
      ],
    },
  }
  const GROUP = {
    id: 'group-1',
    workflowId: 'workflow-1',
    type: 'enrichment' as const,
    outputs: [
      { blockId: 'b1', path: 'email', columnName: 'col-email' },
      { blockId: 'b1', path: 'title', columnName: 'col-title' },
    ],
  }
  const ROW = {
    id: 'row-1',
    data: { 'col-email': 'ada@example.com', 'col-name': 'Ada' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:02.000Z'),
  }
  const RUN_STATE = {
    status: 'completed' as const,
    executionId: 'exec-1',
    jobId: null,
    workflowId: 'workflow-1',
    error: null,
  }

  function read() {
    const request = new NextRequest(
      `http://localhost/api/v2/tables/table-1/rows/row-1/enrichment/group-1?workspaceId=${WORKSPACE_ID}`,
      { method: 'GET', headers: { 'x-api-key': 'secret' } }
    )
    return {
      request,
      response: GET(request, {
        params: Promise.resolve({ tableId: 'table-1', rowId: 'row-1', groupId: 'group-1' }),
      }),
    }
  }

  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mockReadTableRowEnrichmentDetail.mockResolvedValue({
      table: TABLE,
      row: ROW,
      group: GROUP,
      runState: RUN_STATE,
      detail: DETAIL,
    })
  })

  it('delegates the canonical row and group scope and publishes run state, outputs, and cascade', async () => {
    const invocation = read()
    const response = await invocation.response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        groupId: 'group-1',
        runState: {
          status: 'completed',
          executionId: 'exec-1',
          workflowId: 'workflow-1',
          error: null,
          runningBlockIds: [],
          blockErrors: {},
          canceledAt: null,
        },
        /** Keyed by column name; the declared-but-unwritten output is null, not absent. */
        outputs: { email: 'ada@example.com', title: null },
        cascade: DETAIL,
      },
    })
    expect(mockReadTableRowEnrichmentDetail).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        tableId: 'table-1',
        rowId: 'row-1',
        groupId: 'group-1',
        assertedWorkspaceId: WORKSPACE_ID,
      },
      request: invocation.request,
    })
  })

  /** A row that exists always answers; a group that never ran is `runState: null`, not a bare null. */
  it('answers the row with a null run state when the group has never run for it', async () => {
    mockReadTableRowEnrichmentDetail.mockResolvedValue({
      table: TABLE,
      row: ROW,
      group: GROUP,
      runState: null,
      detail: null,
    })

    const response = await read().response

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        groupId: 'group-1',
        runState: null,
        outputs: { email: 'ada@example.com', title: null },
        cascade: null,
      },
    })
  })

  it('publishes a failed run with its error and the canceled spelling', async () => {
    mockReadTableRowEnrichmentDetail.mockResolvedValue({
      table: TABLE,
      row: ROW,
      group: GROUP,
      runState: {
        ...RUN_STATE,
        status: 'cancelled',
        error: 'boom',
        blockErrors: { b1: 'boom' },
        cancelledAt: '2026-01-01T00:00:03.000Z',
      },
      detail: null,
    })

    const body = await (await read().response).json()

    expect(body.data.runState).toMatchObject({
      status: 'canceled',
      error: 'boom',
      blockErrors: { b1: 'boom' },
      canceledAt: '2026-01-01T00:00:03.000Z',
    })
  })
})
