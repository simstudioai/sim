/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockMarkImportCanceled, mockAppendTableEvent } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockMarkImportCanceled: vi.fn(),
  mockAppendTableEvent: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({ markImportCanceled: mockMarkImportCanceled }))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: mockAppendTableEvent }))
vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'denied' }, { status: result.status }),
  }
})

import { POST } from '@/app/api/table/[tableId]/import/cancel/route'

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: { columns: [{ name: 'name', type: 'string' }] },
    metadata: null,
    rowCount: 0,
    maxRows: 1_000_000,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeRequest(body: unknown, tableId = 'tbl_1') {
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/import/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId }) })
}

const validBody = { workspaceId: 'workspace-1', importId: 'import-id-xyz' }

describe('POST /api/table/[tableId]/import/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockMarkImportCanceled.mockResolvedValue(true)
  })

  it('cancels the import and emits a canceled event', async () => {
    const response = await makeRequest(validBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual({ canceled: true })
    expect(mockMarkImportCanceled).toHaveBeenCalledWith('tbl_1', 'import-id-xyz')
    expect(mockAppendTableEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'import', status: 'canceled', importId: 'import-id-xyz' })
    )
  })

  it('does not emit an event when nothing was importing', async () => {
    mockMarkImportCanceled.mockResolvedValue(false)
    const response = await makeRequest(validBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual({ canceled: false })
    expect(mockAppendTableEvent).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(401)
    expect(mockMarkImportCanceled).not.toHaveBeenCalled()
  })

  it('returns the access error status when access is denied', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(403)
  })

  it('returns 400 on workspace mismatch', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable({ workspaceId: 'other-ws' }) })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(400)
    expect(mockMarkImportCanceled).not.toHaveBeenCalled()
  })
})
