/**
 * @vitest-environment node
 *
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

import { InternalUnauthenticatedError } from '@/lib/api/server/routes'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { DELETE, GET, PATCH } from '@/app/api/table/[tableId]/rows/[rowId]/route'

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

function executorPrincipal() {
  mocks.authenticate.mockResolvedValue({
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'user-1',
    workspaceId: WORKSPACE_ID,
    delegationId: 'delegation-1',
    audience: 'table',
    issuedAt: new Date('2026-01-01'),
    expiresAt: new Date('2026-01-02'),
  })
}

function unauthenticated() {
  mocks.authenticate.mockRejectedValue(new InternalUnauthenticatedError())
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
  vi.clearAllMocks()
  sessionPrincipal()
  mocks.readRow.mockResolvedValue({ table: TABLE, row: ROW })
  mocks.updateRow.mockResolvedValue({ table: TABLE, row: ROW, changed: true })
  mocks.deleteRow.mockResolvedValue({ table: TABLE, deletedRowId: ROW_ID })
})

describe('GET /api/table/[tableId]/rows/[rowId]', () => {
  it('returns 401 when the caller is not authenticated', async () => {
    unauthenticated()

    const response = await GET(getRequest(), routeContext())

    expect(response.status).toBe(401)
    expect(mocks.readRow).not.toHaveBeenCalled()
  })

  it('returns 400 when workspaceId is absent from the query string', async () => {
    const response = await GET(getRequest(null), routeContext())

    expect(response.status).toBe(400)
    expect(mocks.readRow).not.toHaveBeenCalled()
  })

  it('asserts the caller-supplied workspace on the use case rather than checking it here', async () => {
    await GET(getRequest(), routeContext())

    expect(mocks.readRow.mock.calls[0][0].input).toMatchObject({
      tableId: TABLE_ID,
      rowId: ROW_ID,
      assertedWorkspaceId: WORKSPACE_ID,
    })
  })

  it('returns 404 when the row does not exist', async () => {
    mocks.readRow.mockRejectedValue(new OrchestrationError('not_found', 'Row not found'))

    const response = await GET(getRequest(), routeContext())

    expect(response.status).toBe(404)
  })

  it('returns the row with ISO-8601 timestamps under data.row', async () => {
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

  it('returns column names to a workflow execution', async () => {
    executorPrincipal()

    const response = await GET(getRequest(), routeContext())

    const body = await response.json()
    expect(body.data.row.data).toEqual({ Name: 'Ada', Age: 36 })
  })
})

describe('PATCH /api/table/[tableId]/rows/[rowId]', () => {
  const patchBody = { workspaceId: WORKSPACE_ID, data: { col_aaa: 'Grace' } }

  it('returns 401 when the caller is not authenticated', async () => {
    unauthenticated()

    const response = await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(response.status).toBe(401)
    expect(mocks.updateRow).not.toHaveBeenCalled()
  })

  it('returns 400 when the body fails contract validation', async () => {
    const response = await PATCH(
      bodyRequest('PATCH', { workspaceId: WORKSPACE_ID }),
      routeContext()
    )

    expect(response.status).toBe(400)
    expect(mocks.updateRow).not.toHaveBeenCalled()
  })

  it('returns the updated row and the success message', async () => {
    const response = await PATCH(bodyRequest('PATCH', patchBody), routeContext())

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
        message: 'Row updated successfully',
      },
    })
  })

  it('tells the use case a session speaks column ids', async () => {
    await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(mocks.updateRow.mock.calls[0][0].input).toMatchObject({
      data: { col_aaa: 'Grace' },
      dataKeying: 'ids',
      strictWrite: false,
    })
  })

  it('tells the use case a workflow execution speaks column names', async () => {
    executorPrincipal()

    await PATCH(
      bodyRequest('PATCH', { workspaceId: WORKSPACE_ID, data: { Name: 'Grace' } }),
      routeContext()
    )

    expect(mocks.updateRow.mock.calls[0][0].input).toMatchObject({
      data: { Name: 'Grace' },
      dataKeying: 'names',
    })
  })

  it('hands the provenance envelope over unresolved rather than interpreting it', async () => {
    await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(mocks.updateRow.mock.calls[0][0].input.secretProvenanceEnvelope).toEqual({
      kind: 'none',
    })
  })

  it('forwards the originating tab so that tab can skip its own refetch', async () => {
    await PATCH(bodyRequest('PATCH', patchBody, { 'x-sim-client-id': 'tab-42' }), routeContext())

    expect(mocks.updateRow.mock.calls[0][0].input.actorClientId).toBe('tab-42')
  })

  it('projects a classified orchestration failure instead of a generic 500', async () => {
    mocks.updateRow.mockRejectedValue(new OrchestrationError('conflict', 'Row changed'))

    const response = await PATCH(bodyRequest('PATCH', patchBody), routeContext())

    expect(response.status).toBe(409)
  })
})

describe('DELETE /api/table/[tableId]/rows/[rowId]', () => {
  const deleteBody = { workspaceId: WORKSPACE_ID }

  it('returns 401 when the caller is not authenticated', async () => {
    unauthenticated()

    const response = await DELETE(bodyRequest('DELETE', deleteBody), routeContext())

    expect(response.status).toBe(401)
    expect(mocks.deleteRow).not.toHaveBeenCalled()
  })

  it('reports a deleted count of one on success', async () => {
    const response = await DELETE(bodyRequest('DELETE', deleteBody), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { message: 'Row deleted successfully', deletedCount: 1 },
    })
  })

  it('forwards the originating tab so that tab can skip its own refetch', async () => {
    await DELETE(bodyRequest('DELETE', deleteBody, { 'x-sim-client-id': 'tab-42' }), routeContext())

    expect(mocks.deleteRow.mock.calls[0][0].input.actorClientId).toBe('tab-42')
  })
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

  it('answers a generic 500 message where the handler named the operation', async () => {
    // The builder has one internal error envelope, shared with ~80 other
    // migrated routes. The old per-route text ("Failed to update row") was more
    // specific; consistency won, and the client only ever toasts the message.
    mocks.updateRow.mockRejectedValue(new Error('boom'))

    const response = await PATCH(
      bodyRequest('PATCH', { workspaceId: WORKSPACE_ID, data: { col_aaa: 'x' } }),
      routeContext()
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: 'Internal server error' })
  })

  it('conceals a mismatched workspace assertion as 404, where it used to answer 400', async () => {
    mocks.updateRow.mockRejectedValue(new OrchestrationError('not_found', 'Table not found'))

    const response = await PATCH(
      bodyRequest('PATCH', { workspaceId: 'workspace-other', data: { col_aaa: 'x' } }),
      routeContext()
    )

    expect(response.status).toBe(404)
  })
})
