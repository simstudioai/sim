/**
 * @vitest-environment node
 *
 * Characterization tests for the single-row surface.
 *
 * These pin the wire behavior this route emits TODAY — status codes, body
 * shapes, date serialization, and which collaborators are invoked — so the
 * route can be migrated onto the shared internal route builder without
 * silently changing what clients observe. They intentionally assert the
 * existing contract rather than an idealized one.
 */
import { hybridAuthMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const {
  mockCheckAccess,
  mockUpdateRow,
  mockPerformDeleteTableRow,
  mockSignalTableRowsChangedByActor,
} = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockPerformDeleteTableRow: vi.fn(),
  mockSignalTableRowsChangedByActor: vi.fn(),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'Access denied' }, { status: result.status }),
    orchestrationErrorResponse: (error: unknown) =>
      (error as { __orchestrated?: boolean })?.__orchestrated
        ? NextResponse.json({ error: 'Orchestration failed' }, { status: 409 })
        : null,
    orchestrationOutcomeErrorResponse: (_outcome: unknown, message: string) =>
      NextResponse.json({ error: message }, { status: 400 }),
    tableLockErrorResponse: (error: unknown) =>
      (error as { __locked?: boolean })?.__locked
        ? NextResponse.json({ error: 'Table is locked' }, { status: 423 })
        : null,
  }
})

vi.mock('@/lib/table', async () => {
  const columnKeys = await import('@/lib/table/column-keys')
  return { ...columnKeys, updateRow: mockUpdateRow }
})

vi.mock('@/lib/table/orchestration', () => ({
  performDeleteTableRow: mockPerformDeleteTableRow,
}))

vi.mock('@/lib/table/events', () => ({
  signalTableRowsChangedByActor: mockSignalTableRowsChangedByActor,
}))

import { DELETE, GET, PATCH } from '@/app/api/table/[tableId]/rows/[rowId]/route'

const TABLE_ID = 'tbl_1'
const ROW_ID = 'row_1'
const WORKSPACE_ID = 'workspace-1'
const CREATED_AT = new Date('2024-01-01T00:00:00.000Z')
const UPDATED_AT = new Date('2024-02-02T00:00:00.000Z')

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: TABLE_ID,
    name: 'People',
    description: null,
    schema: {
      columns: [
        { id: 'col_aaa', name: 'Name', type: 'string' },
        { id: 'col_bbb', name: 'Age', type: 'number' },
      ],
    },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: WORKSPACE_ID,
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  } as TableDefinition
}

function buildStoredRow() {
  return {
    id: ROW_ID,
    data: { col_aaa: 'Ada', col_bbb: 36 },
    position: 0,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  }
}

function authAs(authType: 'session' | 'internal_jwt' = 'session') {
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType,
  })
}

function unauthenticated() {
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
}

function routeContext() {
  return { params: Promise.resolve({ tableId: TABLE_ID, rowId: ROW_ID }) }
}

function getRequest(workspaceId: string | null = WORKSPACE_ID) {
  const url = new URL(`http://localhost/api/table/${TABLE_ID}/rows/${ROW_ID}`)
  if (workspaceId !== null) url.searchParams.set('workspaceId', workspaceId)
  return new NextRequest(url, { method: 'GET' })
}

function bodyRequest(method: 'PATCH' | 'DELETE', body: unknown) {
  return new NextRequest(`http://localhost/api/table/${TABLE_ID}/rows/${ROW_ID}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  authAs()
  mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
})

describe('GET /api/table/[tableId]/rows/[rowId]', () => {
  it('returns 401 when the caller is not authenticated', async () => {
    unauthenticated()

    const response = await GET(getRequest(), routeContext())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' })
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })

  it('returns 400 when workspaceId is absent from the query string', async () => {
    const response = await GET(getRequest(null), routeContext())

    expect(response.status).toBe(400)
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })

  it('propagates the access decision when the caller lacks read access', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const response = await GET(getRequest(), routeContext())

    expect(response.status).toBe(403)
    expect(mockCheckAccess).toHaveBeenCalledWith(TABLE_ID, 'user-1', 'read')
  })

  it('returns 400 when the asserted workspace does not own the table', async () => {
    const response = await GET(getRequest('workspace-other'), routeContext())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid workspace ID' })
  })

  it('returns 404 when the row does not exist', async () => {
    queueTableRows(schemaMock.userTableRows, [])

    const response = await GET(getRequest(), routeContext())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Row not found' })
  })

  it('returns the row with ISO-8601 timestamps under data.row', async () => {
    queueTableRows(schemaMock.userTableRows, [buildStoredRow()])

    const response = await GET(getRequest(), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        row: {
          id: ROW_ID,
          data: { col_aaa: 'Ada', col_bbb: 36 },
          position: 0,
          createdAt: CREATED_AT.toISOString(),
          updatedAt: UPDATED_AT.toISOString(),
        },
      },
    })
  })
})

describe('PATCH /api/table/[tableId]/rows/[rowId]', () => {
  const patchBody = { workspaceId: WORKSPACE_ID, data: { col_aaa: 'Grace' } }

  beforeEach(() => {
    mockUpdateRow.mockResolvedValue({
      ...buildStoredRow(),
      data: { col_aaa: 'Grace', col_bbb: 36 },
    })
  })

  it('returns 401 when the caller is not authenticated', async () => {
    unauthenticated()

    const response = await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(response.status).toBe(401)
    expect(mockUpdateRow).not.toHaveBeenCalled()
  })

  it('returns 400 when the body fails contract validation', async () => {
    const response = await PATCH(
      bodyRequest('PATCH', { workspaceId: WORKSPACE_ID }),
      routeContext()
    )

    expect(response.status).toBe(400)
    expect(mockUpdateRow).not.toHaveBeenCalled()
  })

  it('requires write access, not read access', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const response = await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(response.status).toBe(403)
    expect(mockCheckAccess).toHaveBeenCalledWith(TABLE_ID, 'user-1', 'write')
  })

  it('returns 400 when the asserted workspace does not own the table', async () => {
    const response = await PATCH(
      bodyRequest('PATCH', { ...patchBody, workspaceId: 'workspace-other' }),
      routeContext()
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid workspace ID' })
    expect(mockUpdateRow).not.toHaveBeenCalled()
  })

  it('returns the updated row and the success message', async () => {
    const response = await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        row: {
          id: ROW_ID,
          data: { col_aaa: 'Grace', col_bbb: 36 },
          position: 0,
          createdAt: CREATED_AT.toISOString(),
          updatedAt: UPDATED_AT.toISOString(),
        },
        message: 'Row updated successfully',
      },
    })
  })

  it('passes the acting user and the column-keyed patch to updateRow', async () => {
    await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(mockUpdateRow).toHaveBeenCalledTimes(1)
    const [input, table] = mockUpdateRow.mock.calls[0]
    expect(input).toMatchObject({
      tableId: TABLE_ID,
      rowId: ROW_ID,
      workspaceId: WORKSPACE_ID,
      actorUserId: 'user-1',
      data: { col_aaa: 'Grace' },
    })
    expect(table.id).toBe(TABLE_ID)
  })

  it('translates column names to ids for an internal JWT caller', async () => {
    authAs('internal_jwt')

    await PATCH(
      bodyRequest('PATCH', { workspaceId: WORKSPACE_ID, data: { Name: 'Grace' } }),
      routeContext()
    )

    expect(mockUpdateRow.mock.calls[0][0]).toMatchObject({ data: { col_aaa: 'Grace' } })
  })

  it('returns column names to an internal JWT caller', async () => {
    authAs('internal_jwt')

    const response = await PATCH(
      bodyRequest('PATCH', { workspaceId: WORKSPACE_ID, data: { Name: 'Grace' } }),
      routeContext()
    )

    const body = await response.json()
    expect(body.data.row.data).toEqual({ Name: 'Grace', Age: 36 })
  })

  it('signals open collaborators that the row changed', async () => {
    await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(mockSignalTableRowsChangedByActor).toHaveBeenCalledWith(TABLE_ID, undefined)
  })

  it('forwards the originating tab id so that tab ignores its own broadcast', async () => {
    const request = new NextRequest(`http://localhost/api/table/${TABLE_ID}/rows/${ROW_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-sim-client-id': 'tab-42' },
      body: JSON.stringify(patchBody),
    })

    await PATCH(request, routeContext())

    expect(mockSignalTableRowsChangedByActor).toHaveBeenCalledWith(TABLE_ID, 'tab-42')
  })

  it('projects a classified orchestration failure instead of a generic 500', async () => {
    mockUpdateRow.mockRejectedValue(Object.assign(new Error('conflict'), { __orchestrated: true }))

    const response = await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(response.status).toBe(409)
  })

  it('falls back to 500 for an unclassified failure', async () => {
    mockUpdateRow.mockRejectedValue(new Error('boom'))

    const response = await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to update row' })
  })
})

describe('DELETE /api/table/[tableId]/rows/[rowId]', () => {
  const deleteBody = { workspaceId: WORKSPACE_ID }

  beforeEach(() => {
    mockPerformDeleteTableRow.mockResolvedValue({ success: true })
  })

  it('returns 401 when the caller is not authenticated', async () => {
    unauthenticated()

    const response = await DELETE(bodyRequest('DELETE', deleteBody), routeContext())

    expect(response.status).toBe(401)
    expect(mockPerformDeleteTableRow).not.toHaveBeenCalled()
  })

  it('requires write access', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const response = await DELETE(bodyRequest('DELETE', deleteBody), routeContext())

    expect(response.status).toBe(403)
    expect(mockCheckAccess).toHaveBeenCalledWith(TABLE_ID, 'user-1', 'write')
  })

  it('returns 400 when the asserted workspace does not own the table', async () => {
    const response = await DELETE(
      bodyRequest('DELETE', { workspaceId: 'workspace-other' }),
      routeContext()
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid workspace ID' })
    expect(mockPerformDeleteTableRow).not.toHaveBeenCalled()
  })

  it('reports a deleted count of one on success', async () => {
    const response = await DELETE(bodyRequest('DELETE', deleteBody), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { message: 'Row deleted successfully', deletedCount: 1 },
    })
    expect(mockSignalTableRowsChangedByActor).toHaveBeenCalledWith(TABLE_ID, undefined)
  })

  it('projects an unsuccessful delete outcome as a client error', async () => {
    mockPerformDeleteTableRow.mockResolvedValue({ success: false })

    const response = await DELETE(bodyRequest('DELETE', deleteBody), routeContext())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to delete row' })
    expect(mockSignalTableRowsChangedByActor).not.toHaveBeenCalled()
  })

  it('projects a table lock failure ahead of the generic handler', async () => {
    mockPerformDeleteTableRow.mockRejectedValue(
      Object.assign(new Error('locked'), { __locked: true })
    )

    const response = await DELETE(bodyRequest('DELETE', deleteBody), routeContext())

    expect(response.status).toBe(423)
  })
})
