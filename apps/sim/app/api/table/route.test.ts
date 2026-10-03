import {
  createExecutorPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { tableApiMock, tableApiMockFns } from '@sim/testing/mocks/table-api.mock'
import {
  tableApplicationTablesMock,
  tableApplicationTablesMockFns,
} from '@sim/testing/mocks/table-application-tables.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/api', () => tableApiMock)

vi.mock('@/lib/table/application/tables', () => tableApplicationTablesMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { POST } from '@/app/api/table/route'

const mocks = {
  authenticate: tableApiMockFns.mockAuthenticate,
  createTable: tableApplicationTablesMockFns.mockCreateTableUseCase,
  listTables: tableApplicationTablesMockFns.mockListTableDefinitionsUseCase,
}

const TABLE = {
  id: 'table-1',
  name: 'people',
  description: null,
  schema: { columns: [{ id: 'column-1', name: 'name', type: 'string' as const }] },
  rowCount: 0,
  maxRows: 10_000,
  workspaceId: 'workspace-1',
  folderId: null,
  createdBy: 'user-1',
  locks: {
    schemaLocked: false,
    insertLocked: false,
    updateLocked: false,
    deleteLocked: false,
  },
  archivedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function sessionPrincipal() {
  mocks.authenticate.mockResolvedValue(createSessionPrincipal())
}

function executorPrincipal() {
  mocks.authenticate.mockResolvedValue(
    createExecutorPrincipal({ audience: 'sim:tables', workspaceId: 'workspace-canonical' })
  )
}

function post(body: unknown) {
  return POST(createMockRequest({ method: 'POST', url: 'http://localhost/api/table', body }), {})
}

describe('/api/table application adapter', () => {
  beforeEach(() => {
    sessionPrincipal()
    mocks.createTable.mockResolvedValue({ table: TABLE, folderPath: '/' })
    mocks.listTables.mockResolvedValue({
      tables: [TABLE],
    })
  })

  it('uses canonical delegated workspace instead of the body assertion', async () => {
    executorPrincipal()
    await post({
      workspaceId: 'workspace-forged',
      name: 'people',
      schema: { columns: [{ name: 'name', type: 'string' }] },
    })

    expect(mocks.createTable.mock.calls[0][0].input.workspaceId).toBe('workspace-canonical')
  })
})
