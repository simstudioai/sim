/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockTableV2FeatureDisabledError } = vi.hoisted(() => {
  class MockTableV2FeatureDisabledError extends Error {
    constructor() {
      super('The v2 table query API is not enabled for this workspace')
    }
  }
  return {
    MockTableV2FeatureDisabledError,
    mocks: { authenticate: vi.fn(), queryRows: vi.fn() },
  }
})

vi.mock('@/lib/table/api', () => ({
  internalTableSessionOrExecutorAuth: {
    authenticate: vi.fn(),
    authenticateWithTransport: mocks.authenticate,
  },
}))

vi.mock('@/lib/table/api/row-route-policies', () => ({
  internalTableV2QueryErrorPolicy: {
    project: (error: unknown) =>
      error instanceof MockTableV2FeatureDisabledError
        ? {
            status: 403,
            body: { error: error.message, code: 'tables_v2_disabled' },
          }
        : null,
  },
}))

vi.mock('@/lib/table/application/rows', () => ({
  TableV2FeatureDisabledError: MockTableV2FeatureDisabledError,
  queryTableRows: { operation: { id: 'tables.rows.query' }, execute: mocks.queryRows },
}))

import { TableV2FeatureDisabledError } from '@/lib/table/application/rows'
import { POST } from '@/app/api/table/[tableId]/query/route'

const TABLE = {
  id: 'table-1',
  workspaceId: 'workspace-1',
  schema: {
    columns: [
      { id: 'column-name', name: 'Name', type: 'string' as const },
      { id: 'column-age', name: 'Age', type: 'number' as const },
    ],
  },
}

const ROW = {
  id: 'row-1',
  data: { 'column-name': 'Ada', 'column-age': 36 },
  position: 0,
  orderKey: 'a0',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function sessionPrincipal() {
  mocks.authenticate.mockResolvedValue({
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    transport: 'session',
  })
}

function executorPrincipal() {
  mocks.authenticate.mockResolvedValue({
    principal: {
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-canonical',
      delegationId: 'delegation-1',
      audience: 'sim:tables',
      issuedAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-01-02'),
    },
    transport: 'executor_jwt',
    executionWorkspaceId: 'workspace-canonical',
  })
}

function callQuery(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost/api/table/table-1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tableId: 'table-1' }) }
  )
}

describe('POST /api/table/[tableId]/query application adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionPrincipal()
    mocks.queryRows.mockResolvedValue({
      table: TABLE,
      rows: [ROW],
      rowCount: 1,
      totalCount: 1,
      limit: 10,
      offset: 0,
      nextCursor: null,
    })
  })

  it('passes typed query semantics and feature admission to the shared use case', async () => {
    const response = await callQuery({
      workspaceId: 'workspace-1',
      predicate: { field: 'Name', op: 'eq', value: 'Ada' },
      sort: [{ field: 'Age', direction: 'desc' }],
      columns: ['Name'],
      limit: 10,
    })

    expect(response.status).toBe(200)
    expect(mocks.queryRows.mock.calls[0][0].input).toMatchObject({
      assertedWorkspaceId: 'workspace-1',
      columns: ['Name'],
      limit: 10,
      allowExpandedLimit: true,
      requireV2Feature: true,
      includeTotal: true,
    })
    expect((await response.json()).data.rows[0].data).toEqual({
      'column-name': 'Ada',
      'column-age': 36,
    })
  })

  it('uses canonical delegated workspace and returns name-keyed rows', async () => {
    executorPrincipal()
    const response = await callQuery({ workspaceId: 'workspace-forged', limit: 10 })

    expect(mocks.queryRows.mock.calls[0][0].input.assertedWorkspaceId).toBe('workspace-canonical')
    expect((await response.json()).data.rows[0].data).toEqual({ Name: 'Ada', Age: 36 })
  })

  it('projects the feature gate error with the compatibility code', async () => {
    mocks.queryRows.mockRejectedValueOnce(new TableV2FeatureDisabledError())

    const response = await callQuery({ workspaceId: 'workspace-1', limit: 10 })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: 'The v2 table query API is not enabled for this workspace',
      code: 'tables_v2_disabled',
    })
  })

  it('does not recompute the total count on cursor pages', async () => {
    await callQuery({ workspaceId: 'workspace-1', limit: 10, cursor: 'cursor-1' })
    expect(mocks.queryRows.mock.calls[0][0].input.includeTotal).toBe(false)
  })
})
