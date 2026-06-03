/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockMarkTableImporting, mockRunTableImport } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockMarkTableImporting: vi.fn(),
  mockRunTableImport: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('import-id-xyz'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))
vi.mock('@/lib/table/service', () => ({ markTableImporting: mockMarkTableImporting }))
vi.mock('@/lib/table/import-runner', () => ({ runTableImport: mockRunTableImport }))
vi.mock('@/lib/core/utils/background', () => ({
  runDetached: (_label: string, work: () => Promise<unknown>) => {
    void work()
  },
}))
vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'denied' }, { status: result.status }),
  }
})

import { POST } from '@/app/api/table/[tableId]/import-async/route'

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
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/import-async`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId }) })
}

const validBody = {
  workspaceId: 'workspace-1',
  fileKey: 'workspace/workspace-1/123-data.csv',
  fileName: 'data.csv',
  mode: 'append',
}

describe('POST /api/table/[tableId]/import-async', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockMarkTableImporting.mockResolvedValue(true)
    mockRunTableImport.mockResolvedValue(undefined)
  })

  it('marks the table importing and kicks off the worker with mode + mapping', async () => {
    const response = await makeRequest({
      ...validBody,
      mode: 'replace',
      mapping: { Name: 'name' },
      createColumns: ['Extra'],
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual({ tableId: 'tbl_1', importId: 'import-id-xyz' })
    expect(mockMarkTableImporting).toHaveBeenCalledWith('tbl_1', 'import-id-xyz')
    expect(mockRunTableImport).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'tbl_1',
        mode: 'replace',
        delimiter: ',',
        mapping: { Name: 'name' },
        createColumns: ['Extra'],
      })
    )
  })

  it('returns 409 when the table is already importing (claim lost)', async () => {
    mockMarkTableImporting.mockResolvedValue(false)
    const response = await makeRequest(validBody)
    expect(response.status).toBe(409)
    expect(mockRunTableImport).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(401)
    expect(mockMarkTableImporting).not.toHaveBeenCalled()
  })

  it('returns the access error status when access is denied', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(403)
    expect(mockRunTableImport).not.toHaveBeenCalled()
  })

  it('returns 400 when the target table is archived', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable({ archivedAt: new Date() }) })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(400)
    expect(mockRunTableImport).not.toHaveBeenCalled()
  })

  it('returns 400 on workspace mismatch', async () => {
    const response = await makeRequest({ ...validBody, workspaceId: 'other-ws' })
    expect(response.status).toBe(400)
  })

  it('returns 400 for an invalid mode', async () => {
    const response = await makeRequest({ ...validBody, mode: 'bogus' })
    expect(response.status).toBe(400)
  })
})
