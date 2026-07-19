/**
 * @vitest-environment node
 *
 * The public rows endpoint is addressed by `(token, moduleId)` only — it accepts
 * no `tableId`. These tests pin STEP 5 of §2.3 (the same-workspace re-assert
 * that closes the §2.4 grandfathering hole) and §2.6's projection narrowing:
 * no `filter`, no `sort`, a hard page cap, and a total-row ceiling.
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnforcePerIp,
  mockEnforcePerShare,
  mockResolvePublicInterfaceModule,
  mockGetTableById,
  mockQueryRows,
} = vi.hoisted(() => ({
  mockEnforcePerIp: vi.fn(),
  mockEnforcePerShare: vi.fn(),
  mockResolvePublicInterfaceModule: vi.fn(),
  mockGetTableById: vi.fn(),
  mockQueryRows: vi.fn(),
}))

vi.mock('@/lib/public-shares/rate-limit', () => ({
  enforcePerIpRateLimit: mockEnforcePerIp,
  enforcePerShareRateLimit: mockEnforcePerShare,
}))

vi.mock('@/lib/public-shares/interface-access', () => ({
  resolvePublicInterfaceModule: mockResolvePublicInterfaceModule,
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
}))

vi.mock('@/lib/table/rows/service', () => ({
  queryRows: mockQueryRows,
}))

import { GET } from '@/app/api/interfaces/public/[token]/modules/[moduleId]/table/rows/route'

const TOKEN = 'tok_1'
const MODULE_ID = 'mod-table'
const WS = 'ws-a'
const OTHER_WS = 'ws-b'
const TABLE_ID = 'tbl-stored'

const params = (token = TOKEN, moduleId = MODULE_ID) => ({
  params: Promise.resolve({ token, moduleId }),
})

const request = (query = '') =>
  new NextRequest(
    `http://localhost/api/interfaces/public/${TOKEN}/modules/${MODULE_ID}/table/rows${query}`
  )

const tableModule = {
  id: MODULE_ID,
  type: 'table' as const,
  placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
  config: { tableId: TABLE_ID },
}

const access = {
  share: { id: 'sh_1', token: TOKEN, authType: 'public', password: null },
  definition: {
    id: 'int-a',
    workspaceId: WS,
    name: 'Support desk',
    description: null,
    layout: { version: 1, grid: { rows: 2, cols: 2 }, modules: [tableModule] },
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  },
  workspaceId: WS,
  module: tableModule,
  resource: { type: 'table' as const, id: TABLE_ID },
}

function buildTable(overrides: Record<string, unknown> = {}) {
  return {
    id: TABLE_ID,
    name: 'Tickets',
    description: null,
    workspaceId: WS,
    createdBy: 'secret-owner-id',
    archivedAt: null,
    rowCount: 12,
    schema: { columns: [{ id: 'c1', name: 'title', type: 'text' }] },
    metadata: { internalNote: 'do-not-leak' },
    maxRows: 100_000,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('GET /api/interfaces/public/[token]/modules/[moduleId]/table/rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforcePerIp.mockResolvedValue(null)
    mockEnforcePerShare.mockResolvedValue(null)
    mockResolvePublicInterfaceModule.mockResolvedValue({ ok: true, access })
    mockGetTableById.mockResolvedValue(buildTable())
    mockQueryRows.mockResolvedValue({
      rows: [{ id: 'row-1', data: { title: 'Hello' } }],
      rowCount: 1,
      totalCount: 12,
      limit: 100,
      offset: 0,
    })
  })

  it('returns 429 before the authorization chain runs', async () => {
    mockEnforcePerIp.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await GET(request(), params())
    expect(res.status).toBe(429)
    expect(mockResolvePublicInterfaceModule).not.toHaveBeenCalled()
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('uses the content rate-limit scope and consumes the per-IP bucket once', async () => {
    await GET(request(), params())
    expect(mockEnforcePerIp).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerIp).toHaveBeenCalledWith(expect.anything(), 'content')
  })

  /**
   * The per-IP bucket alone does not bound a link that is passed around, so the
   * aggregate per-share ceiling is enforced once the share id is known.
   */
  it('enforces the per-share content bucket with the resolved share id', async () => {
    await GET(request(), params())
    expect(mockEnforcePerShare).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerShare).toHaveBeenCalledWith('content', 'sh_1')
  })

  it('stops on the per-share bucket without reading rows', async () => {
    mockEnforcePerShare.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await GET(request(), params())
    expect(res.status).toBe(429)
    expect(mockGetTableById).not.toHaveBeenCalled()
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('runs the chain with the table type pinned and no client-supplied id', async () => {
    await GET(request('?tableId=tbl-attacker'), params())
    expect(mockResolvePublicInterfaceModule).toHaveBeenCalledWith(
      expect.objectContaining({
        token: TOKEN,
        moduleId: MODULE_ID,
        expectedType: 'table',
      })
    )
    const call = mockResolvePublicInterfaceModule.mock.calls[0][0]
    expect(JSON.stringify(Object.keys(call))).not.toContain('tableId')
  })

  it('propagates the chain response and never reads the table', async () => {
    mockResolvePublicInterfaceModule.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'auth_required_password' }, { status: 401 }),
    })
    const res = await GET(request(), params())
    expect(res.status).toBe(401)
    expect(mockGetTableById).not.toHaveBeenCalled()
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('reads the table id derived from the stored layout', async () => {
    await GET(request('?tableId=tbl-attacker'), params())
    expect(mockGetTableById).toHaveBeenCalledWith(TABLE_ID)
  })

  /**
   * §2.4 — `validateLayout` grandfathers references that were already stored, so
   * a stored reference is only proven in-workspace at the moment it was
   * introduced. STEP 5 re-checks on every read.
   */
  it('404s when the derived table lives in another workspace', async () => {
    mockGetTableById.mockResolvedValueOnce(buildTable({ workspaceId: OTHER_WS }))
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  /**
   * `getTableById` excludes archived tables unless explicitly opted in, so
   * never opting in is what makes "table archived after sharing" 404.
   */
  it('never opts into archived tables', async () => {
    await GET(request(), params())
    expect(mockGetTableById).toHaveBeenCalledWith(TABLE_ID)
    const options = mockGetTableById.mock.calls[0][1]
    expect(options?.includeArchived).toBeFalsy()
  })

  it('404s when the derived table no longer resolves', async () => {
    mockGetTableById.mockResolvedValueOnce(null)
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('serves rows for an in-workspace table', async () => {
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0]).toEqual(expect.objectContaining({ id: 'row-1', data: { title: 'Hello' } }))
  })

  /**
   * §2.6 — per-row workflow run state (run ids, statuses, costs) is internal
   * workspace state. It is excluded from the read AND pinned empty on the wire.
   */
  it('strips per-row execution state from the payload', async () => {
    mockQueryRows.mockResolvedValueOnce({
      rows: [
        {
          id: 'row-1',
          data: { title: 'Hello' },
          executions: { 'wf-secret': { status: 'failed', cost: 1.23 } },
          position: 0,
          orderKey: 'a0',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      rowCount: 1,
      totalCount: 1,
      limit: 100,
      offset: 0,
    })
    const res = await GET(request(), params())
    const body = await res.json()
    expect(body.rows[0].executions).toEqual({})
    expect(JSON.stringify(body)).not.toContain('wf-secret')
    expect(mockQueryRows.mock.calls[0][1].withExecutions).toBe(false)
  })

  it('never sends the client filter or sort into the row query', async () => {
    await GET(
      request(
        '?filter=%7B%22title%22%3A%7B%22eq%22%3A%22x%22%7D%7D&sort=%7B%22column%22%3A%22id%22%7D'
      ),
      params()
    )
    expect(mockQueryRows).toHaveBeenCalledTimes(1)
    const options = mockQueryRows.mock.calls[0][1]
    expect(options.filter).toBeUndefined()
    expect(options.sort).toBeUndefined()
  })

  it('rejects a page size above the public cap instead of silently widening it', async () => {
    const res = await GET(request('?limit=5000'), params())
    expect(res.status).toBe(400)
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('rejects an offset beyond the public row ceiling', async () => {
    const res = await GET(request('?offset=100000'), params())
    expect(res.status).toBe(400)
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('never reads more rows than remain under the 1000-row ceiling', async () => {
    await GET(request('?limit=100&offset=950'), params())
    expect(mockQueryRows.mock.calls[0][1].limit).toBe(50)
  })

  it('does not advertise more rows past the 1000-row public ceiling', async () => {
    mockQueryRows.mockResolvedValueOnce({
      rows: [{ id: 'row-1000', data: {} }],
      rowCount: 1,
      totalCount: 50_000,
      limit: 100,
      offset: 1000,
    })
    const res = await GET(request('?offset=1000'), params())
    expect(res.status).toBe(200)
    expect((await res.json()).hasMore).toBe(false)
  })

  it('never leaks table internals in the response body', async () => {
    const res = await GET(request(), params())
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('secret-owner-id')
    expect(body).not.toContain('do-not-leak')
    expect(body).not.toContain(WS)
  })

  it('sends a no-store cache directive so a revoked link cannot serve stale rows', async () => {
    const res = await GET(request(), params())
    expect(res.headers.get('Cache-Control')).toContain('no-cache')
  })
})
