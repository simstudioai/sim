/**
 * Characterization tests for the single-row surface, carried across its
 * migration onto the shared internal route builder.
 *
 * The assertions are the ones written against the hand-rolled handler — status
 * codes, body shapes, ISO-8601 timestamps, and the dual-caller wire keying,
 * where a session speaks stable column ids and a workflow execution speaks
 * column names. What moved is the seam they mock: the route no longer loads the
 * table or calls the row primitives itself, so the use cases are stubbed and the
 * real builder runs.
 *
 * Two wire changes are deliberate; see the `deliberate wire changes` block.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    readRow: vi.fn(),
    updateRow: vi.fn(),
    deleteRow: vi.fn(),
    authenticate: vi.fn(),
  },
}))

vi.mock('@/lib/table/application/rows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table/application/rows')>()
  return {
    ...actual,
    readTableRow: { operation: { id: 'tables.rows.read' }, execute: mocks.readRow },
    updateTableRow: { operation: { id: 'tables.rows.update' }, execute: mocks.updateRow },
    deleteTableRow: { operation: { id: 'tables.rows.delete' }, execute: mocks.deleteRow },
  }
})

vi.mock('@/lib/table/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table/api')>()
  return { ...actual, internalTableSessionOrExecutorAuth: { authenticate: mocks.authenticate } }
})

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { GET, PATCH } from '@/app/api/table/[tableId]/rows/[rowId]/route'

const TABLE_ID = 'tbl_1'
const ROW_ID = 'row_1'
const WORKSPACE_ID = 'workspace-1'
const CREATED_AT = new Date('2024-01-01T00:00:00.000Z')
const UPDATED_AT = new Date('2024-02-02T00:00:00.000Z')

const TABLE = {
  id: TABLE_ID,
  workspaceId: WORKSPACE_ID,
  schema: {
    columns: [
      { id: 'col_aaa', name: 'Name', type: 'string' as const },
      { id: 'col_bbb', name: 'Age', type: 'number' as const },
    ],
  },
}

const ROW = {
  id: ROW_ID,
  data: { col_aaa: 'Ada', col_bbb: 36 },
  executions: {},
  position: 0,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
}

function sessionPrincipal() {
  mocks.authenticate.mockResolvedValue({
    kind: 'session',
    userId: 'user-1',
    sessionId: 'session-1',
  })
}

function routeContext() {
  return { params: Promise.resolve({ tableId: TABLE_ID, rowId: ROW_ID }) }
}

function getRequest(workspaceId: string | null = WORKSPACE_ID) {
  const url = new URL(`http://localhost/api/table/${TABLE_ID}/rows/${ROW_ID}`)
  if (workspaceId !== null) url.searchParams.set('workspaceId', workspaceId)
  return new NextRequest(url, { method: 'GET' })
}

function bodyRequest(method: 'PATCH' | 'DELETE', body: unknown, headers: HeadersInit = {}) {
  return new NextRequest(`http://localhost/api/table/${TABLE_ID}/rows/${ROW_ID}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  sessionPrincipal()
  mocks.readRow.mockResolvedValue({ table: TABLE, row: ROW })
  mocks.updateRow.mockResolvedValue({ table: TABLE, row: ROW, changed: true })
  mocks.deleteRow.mockResolvedValue({ table: TABLE, deletedRowId: ROW_ID })
})

/**
 * The wire changes the migration makes on purpose.
 *
 * Both follow from adopting the shared concealment policy — what the v2 table
 * surface already does, and what stops a caller learning whether a table it
 * cannot reach exists. Nothing in `hooks/queries/tables.ts` branches on either
 * status, which is why they are safe to change.
 *
 * Note the concealment is narrower than the handler it replaces: the old route
 * answered a blanket 403 for every access failure, while this one conceals only
 * *cross-tenant* denials and still answers 403 for an in-workspace role denial.
 */
describe('deliberate wire changes', () => {
  it('conceals a cross-tenant table as 404, where it used to answer 403', async () => {
    mocks.readRow.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await GET(getRequest(), routeContext())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'Table not found' })
  })

  it('still answers 403 for an in-workspace denial, which is not concealed', async () => {
    mocks.readRow.mockRejectedValue(new OrchestrationError('forbidden', 'Insufficient role'))

    const response = await GET(getRequest(), routeContext())

    expect(response.status).toBe(403)
  })

  it('keeps the lock on a 423 so the client knows which one to clear', async () => {
    mocks.updateRow.mockRejectedValue(new TableLockedError('update'))

    const response = await PATCH(
      bodyRequest('PATCH', { workspaceId: WORKSPACE_ID, data: { col_aaa: 'x' } }),
      routeContext()
    )

    expect(response.status).toBe(423)
    await expect(response.json()).resolves.toMatchObject({ lock: 'update' })
  })
})
