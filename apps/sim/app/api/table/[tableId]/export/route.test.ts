/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockQueryRows } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockQueryRows: vi.fn(),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'Access denied' }, { status: result.status }),
  }
})

vi.mock('@/lib/table/rows/service', () => ({
  queryRows: mockQueryRows,
}))

import { GET } from '@/app/api/table/[tableId]/export/route'

/** Table with an id-native column whose stable id (`col_email`) differs from its display name. */
function buildTable(): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: {
      columns: [
        { id: 'col_email', name: 'email', type: 'string' },
        { name: 'legacy', type: 'string' }, // legacy: id == name
      ],
    },
    metadata: null,
    rowCount: 1,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  }
}

function callGet(format: string) {
  const req = new NextRequest(`http://localhost:3000/api/table/tbl_1/export?format=${format}`, {
    method: 'GET',
  })
  return GET(req, { params: Promise.resolve({ tableId: 'tbl_1' }) })
}

describe('table export route — id→name translation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    // Row data is keyed by stable column id (`col_email`), not the display name.
    mockQueryRows.mockResolvedValue({
      rows: [{ id: 'r1', data: { col_email: 'a@b.c', legacy: 'x' }, executions: {}, position: 0 }],
      rowCount: 1,
      totalCount: 1,
      limit: 1000,
      offset: 0,
    })
  })

  it('CSV: header uses display names and cell values resolve from id-keyed data', async () => {
    const res = await callGet('csv')
    expect(res.status).toBe(200)
    const body = await res.text()
    const [header, firstRow] = body.trim().split('\n')
    expect(header).toBe('email,legacy')
    // Without id→name resolution the email cell would be blank.
    expect(firstRow).toBe('a@b.c,x')
  })

  it('JSON: keys are display names, never the stable column id', async () => {
    const res = await callGet('json')
    expect(res.status).toBe(200)
    const parsed = JSON.parse(await res.text())
    expect(parsed).toEqual([{ email: 'a@b.c', legacy: 'x' }])
    expect(JSON.stringify(parsed)).not.toContain('col_email')
  })
})
