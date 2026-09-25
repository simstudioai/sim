import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createTable: vi.fn(),
  listTables: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('@/lib/table/api', () => ({
  internalTableSessionOrExecutorAuth: { authenticate: mocks.authenticate },
}))

vi.mock('@/lib/table/application/tables', () => ({
  createTableUseCase: { operation: { id: 'tables.create' }, execute: mocks.createTable },
  listTableDefinitionsUseCase: { operation: { id: 'tables.list' }, execute: mocks.listTables },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import { POST } from '@/app/api/table/route'

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
    workspaceId: 'workspace-canonical',
    delegationId: 'delegation-1',
    audience: 'sim:tables',
    issuedAt: new Date('2026-01-01'),
    expiresAt: new Date('2026-01-02'),
  })
}

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/table', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {}
  )
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
