/**
 * @vitest-environment node
 *
 * The upsert surface had no route-level tests. These pin what it emits now that
 * it runs on the shared internal route builder, including the dual-caller wire
 * keying and the provenance envelope being handed over unresolved.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: { upsertRow: vi.fn(), authenticate: vi.fn() },
}))

vi.mock('@/lib/table/application/rows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table/application/rows')>()
  return {
    ...actual,
    upsertTableRow: { operation: { id: 'tables.rows.upsert' }, execute: mocks.upsertRow },
  }
})

vi.mock('@/lib/table/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table/api')>()
  return {
    ...actual,
    internalTableSessionOrExecutorAuth: {
      authenticate: vi.fn(),
      authenticateWithTransport: mocks.authenticate,
    },
  }
})

import { InternalUnauthenticatedError } from '@/lib/api/server/routes'
import { POST } from '@/app/api/table/[tableId]/rows/upsert/route'

const TABLE_ID = 'tbl_1'
const WORKSPACE_ID = 'workspace-1'
const CREATED_AT = new Date('2024-01-01T00:00:00.000Z')
const UPDATED_AT = new Date('2024-02-02T00:00:00.000Z')

const TABLE = {
  id: TABLE_ID,
  workspaceId: WORKSPACE_ID,
  schema: { columns: [{ id: 'col_aaa', name: 'Name', type: 'string' as const }] },
}
const ROW = {
  id: 'row_1',
  data: { col_aaa: 'Ada' },
  executions: {},
  position: 0,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
}

function routeContext() {
  return { params: Promise.resolve({ tableId: TABLE_ID }) }
}

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/table/${TABLE_ID}/rows/upsert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BODY = { workspaceId: WORKSPACE_ID, data: { col_aaa: 'Ada' }, conflictTarget: 'col_aaa' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticate.mockResolvedValue({
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    transport: 'session',
  })
  mocks.upsertRow.mockResolvedValue({ table: TABLE, row: ROW, operation: 'insert' })
})

describe('POST /api/table/[tableId]/rows/upsert', () => {
  it('returns 401 when the caller is not authenticated', async () => {
    mocks.authenticate.mockRejectedValue(new InternalUnauthenticatedError())

    const response = await POST(request(BODY), routeContext())

    expect(response.status).toBe(401)
    expect(mocks.upsertRow).not.toHaveBeenCalled()
  })

  it('names the operation it performed in the body and the message', async () => {
    const response = await POST(request(BODY), routeContext())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        row: {
          id: 'row_1',
          data: { col_aaa: 'Ada' },
          position: 0,
          createdAt: CREATED_AT.toISOString(),
          updatedAt: UPDATED_AT.toISOString(),
        },
        operation: 'insert',
        message: 'Row inserted successfully',
      },
    })
  })

  it('says updated when the row already existed', async () => {
    mocks.upsertRow.mockResolvedValue({ table: TABLE, row: ROW, operation: 'update' })

    const body = await (await POST(request(BODY), routeContext())).json()

    expect(body.data.message).toBe('Row updated successfully')
  })

  it('tells the use case a session speaks column ids and forwards the conflict target', async () => {
    await POST(request(BODY), routeContext())

    expect(mocks.upsertRow.mock.calls[0][0].input).toMatchObject({
      tableId: TABLE_ID,
      assertedWorkspaceId: WORKSPACE_ID,
      dataKeying: 'ids',
      strictWrite: false,
      conflictTarget: 'col_aaa',
    })
  })

  it('tells the use case a workflow execution speaks column names', async () => {
    mocks.authenticate.mockResolvedValue({
      principal: {
        kind: 'system',
        serviceId: 'webhook',
        workspaceId: WORKSPACE_ID,
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'generic',
        executionMetadata: {
          executionId: 'execution-1',
          rootWorkflowId: 'workflow-1',
          currentWorkflow: {
            workflowId: 'workflow-1',
            mode: 'deployment',
            deploymentVersionId: 'deployment-1',
          },
        },
      },
      transport: 'executor_jwt',
      executionWorkspaceId: 'workspace-1',
    })

    await POST(request({ ...BODY, data: { Name: 'Ada' }, conflictTarget: 'Name' }), routeContext())

    expect(mocks.upsertRow.mock.calls[0][0].input).toMatchObject({ dataKeying: 'names' })
  })

  it('hands the provenance envelope over unresolved rather than interpreting it', async () => {
    await POST(request(BODY), routeContext())

    expect(mocks.upsertRow.mock.calls[0][0].input.secretProvenanceEnvelope).toEqual({
      kind: 'none',
    })
  })
})
