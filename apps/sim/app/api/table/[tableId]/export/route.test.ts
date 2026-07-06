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
    // The export loop terminates on an empty page, so the mock must drain.
    mockQueryRows
      .mockResolvedValueOnce({
        rows: [
          { id: 'r1', data: { col_email: 'a@b.c', legacy: 'x' }, executions: {}, position: 0 },
        ],
        rowCount: 1,
        totalCount: 1,
        limit: 1000,
        offset: 0,
      })
      .mockResolvedValue({ rows: [], rowCount: 0, totalCount: 1, limit: 1000, offset: 0 })
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

describe('table export route — keyset pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
  })

  it('drives the after cursor from the last row instead of offset paging', async () => {
    const page = (ids: string[]) => ({
      rows: ids.map((id, i) => ({
        id,
        data: { col_email: `${id}@x`, legacy: 'x' },
        executions: {},
        position: i,
        orderKey: `k-${id}`,
      })),
      rowCount: ids.length,
      totalCount: null,
      limit: 1000,
      offset: 0,
    })
    mockQueryRows
      .mockResolvedValueOnce(page(['r1']))
      .mockResolvedValueOnce(page(['r2']))
      .mockResolvedValue(page([]))

    const res = await callGet('csv')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body.trim().split('\n')).toEqual(['email,legacy', 'r1@x,x', 'r2@x,x'])

    expect(mockQueryRows).toHaveBeenCalledTimes(3)
    expect(mockQueryRows.mock.calls[0][1]).toMatchObject({ after: undefined, includeTotal: false })
    expect(mockQueryRows.mock.calls[1][1]).toMatchObject({ after: { orderKey: 'k-r1', id: 'r1' } })
    expect(mockQueryRows.mock.calls[2][1]).toMatchObject({ after: { orderKey: 'k-r2', id: 'r2' } })
  })

  it('falls back to offset paging for legacy rows without an order key', async () => {
    const legacyPage = (ids: string[]) => ({
      rows: ids.map((id, i) => ({
        id,
        data: { col_email: `${id}@x`, legacy: 'x' },
        executions: {},
        position: i,
      })),
      rowCount: ids.length,
      totalCount: null,
      limit: 1000,
      offset: 0,
    })
    mockQueryRows
      .mockResolvedValueOnce(legacyPage(['r1']))
      .mockResolvedValueOnce(legacyPage(['r2']))
      .mockResolvedValue(legacyPage([]))

    const res = await callGet('csv')
    expect(res.status).toBe(200)

    expect(mockQueryRows).toHaveBeenCalledTimes(3)
    expect(mockQueryRows.mock.calls[1][1]).toMatchObject({ after: undefined, offset: 1 })
    expect(mockQueryRows.mock.calls[2][1]).toMatchObject({ after: undefined, offset: 2 })
  })
})
