/**
 * @vitest-environment node
 *
 * Public v2 workflow list: the search/sort/filter convention, and the keyset
 * cursor's binding to the sort it was minted under. The assertions look at the
 * WHERE/ORDER BY the route hands drizzle, because that is the whole point of
 * the change — a search must narrow the query, not the result.
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockPerformCreateWorkflow,
  mockAssertFolderMutable,
  mockLoadActiveFolderPathIndex,
  FolderLockedErrorMock,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockPerformCreateWorkflow: vi.fn(),
  mockAssertFolderMutable: vi.fn(),
  mockLoadActiveFolderPathIndex: vi.fn(),
  FolderLockedErrorMock: class FolderLockedError extends Error {
    status = 423
  },
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performCreateWorkflow: mockPerformCreateWorkflow,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  assertFolderMutable: mockAssertFolderMutable,
  FolderLockedError: FolderLockedErrorMock,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mockLoadActiveFolderPathIndex,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from '@/app/api/v2/workflows/route'

const WS = 'workspace-1'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf_1',
    name: 'Daily digest',
    description: null,
    folderId: null,
    workspaceId: WS,
    isDeployed: false,
    deployedAt: null,
    runCount: 3,
    lastRunAt: null,
    sortOrder: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  }
}

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/workflows?${query}`))

/** The condition nodes the route passed to `.where()` on the last query. */
const lastConditions = () =>
  flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0]).filter(Boolean)

const lastOrderBy = () => dbChainMockFns.orderBy.mock.calls.at(-1) ?? []

/**
 * Timestamp keys order on `date_trunc('milliseconds', col)` rather than the raw
 * column, so the mocked `sql` fragment carries the column in its interpolated
 * values rather than being the column itself.
 */
const truncatedColumnOf = (entry: { column: { values?: unknown[] } }) => entry.column?.values?.[0]

describe('GET /api/v2/workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockLoadActiveFolderPathIndex.mockResolvedValue({
      rowById: new Map(),
      pathById: new Map(),
      idByPath: new Map(),
    })
  })

  it('narrows the query with a case-insensitive substring match on the name', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    const res = await callList(`workspaceId=${WS}&search=digest`)

    expect(res.status).toBe(200)
    const search = lastConditions().find((c) => c.type === 'ilike')
    expect(search).toMatchObject({ column: schemaMock.workflow.name, pattern: '%digest%' })
  })

  it('escapes LIKE wildcards so a caller cannot widen its own match', async () => {
    queueTableRows(schemaMock.workflow, [])

    await callList(`workspaceId=${WS}&search=${encodeURIComponent('100%_x')}`)

    expect(lastConditions().find((c) => c.type === 'ilike')).toMatchObject({
      pattern: '%100\\%\\_x%',
    })
  })

  it('adds no search condition when the caller did not search', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    await callList(`workspaceId=${WS}`)

    expect(lastConditions().some((c) => c.type === 'ilike')).toBe(false)
  })

  it('treats folderPath=/ as root-only while omission lists every folder', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    await callList(`workspaceId=${WS}&folderPath=%2F`)

    expect(
      lastConditions().some(
        (condition) =>
          condition.type === 'isNull' && condition.column === schemaMock.workflow.folderId
      )
    ).toBe(true)
  })

  it('400s on a sort field outside the enum instead of letting it reach the query', async () => {
    const res = await callList(`workspaceId=${WS}&sortBy=(select 1)`)

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('400s on a sort direction outside the enum', async () => {
    const res = await callList(`workspaceId=${WS}&sortOrder=sideways`)

    expect(res.status).toBe(400)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('400s on an empty search rather than treating it as unsearched', async () => {
    const res = await callList(`workspaceId=${WS}&search=`)

    expect(res.status).toBe(400)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('defaults to the workspace position ordering', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    await callList(`workspaceId=${WS}`)

    const orderBy = lastOrderBy()
    expect(orderBy.map((e: { type: string }) => e.type)).toEqual(['asc', 'asc', 'asc'])
    expect(orderBy[0].column).toBe(schemaMock.workflow.sortOrder)
    expect(truncatedColumnOf(orderBy[1])).toBe(schemaMock.workflow.createdAt)
    expect(orderBy[2].column).toBe(schemaMock.workflow.id)
  })

  it('orders by the requested field and direction', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    await callList(`workspaceId=${WS}&sortBy=name&sortOrder=desc`)

    expect(lastOrderBy()).toEqual([
      { type: 'desc', column: schemaMock.workflow.name },
      { type: 'desc', column: schemaMock.workflow.id },
    ])
  })

  it('combines a filter with a cursor into one consistent page', async () => {
    queueTableRows(schemaMock.workflow, [buildRow(), buildRow({ id: 'wf_2', name: 'Zebra' })])

    const first = await callList(`workspaceId=${WS}&search=a&sortBy=name&limit=1`)
    const body = await first.json()

    expect(body.data).toHaveLength(1)
    expect(body.nextCursor).not.toBeNull()

    queueTableRows(schemaMock.workflow, [buildRow({ id: 'wf_2', name: 'Zebra' })])
    const second = await callList(
      `workspaceId=${WS}&search=a&sortBy=name&limit=1&cursor=${encodeURIComponent(body.nextCursor)}`
    )

    expect(second.status).toBe(200)
    const conditions = lastConditions()
    // The filter survives the cursor page, and the keyset resumes from the last row.
    expect(conditions.find((c) => c.type === 'ilike')).toMatchObject({ pattern: '%a%' })
    expect(conditions.some((c) => c.type === 'or')).toBe(true)
  })

  it('terminates pagination once a filtered page is not full', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    const res = await callList(`workspaceId=${WS}&search=digest&limit=50`)

    expect((await res.json()).nextCursor).toBeNull()
  })

  it('400s when a cursor is replayed under a different sort', async () => {
    queueTableRows(schemaMock.workflow, [buildRow(), buildRow({ id: 'wf_2' })])

    const first = await callList(`workspaceId=${WS}&sortBy=name&limit=1`)
    const { nextCursor } = await first.json()
    vi.clearAllMocks()

    const res = await callList(
      `workspaceId=${WS}&sortBy=createdAt&limit=1&cursor=${encodeURIComponent(nextCursor)}`
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toMatch(/cursor does not match/i)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('400s on a malformed cursor instead of silently restarting from page one', async () => {
    const res = await callList(`workspaceId=${WS}&cursor=not-a-cursor`)

    expect(res.status).toBe(400)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })
})

const RATE_LIMIT_DENIED = {
  allowed: false,
  limit: 100,
  remaining: 0,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 1000,
}

const ACCESS_DENIED = { status: 403, code: 'FORBIDDEN', message: 'Access denied' }

const CREATED = {
  id: 'wf-1',
  name: 'Support Agent',
  description: 'Handles tickets',
  workspaceId: 'workspace-1',
  folderId: null,
  sortOrder: 0,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  startBlockId: 'block-1',
  subBlockValues: {},
}

const VALID_BODY = {
  workspaceId: 'workspace-1',
  name: 'Support Agent',
  description: 'Handles tickets',
}

function callPost(body: unknown) {
  return POST(
    new NextRequest('http://localhost:3000/api/v2/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

describe('POST /api/v2/workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockAssertFolderMutable.mockResolvedValue(undefined)
    mockLoadActiveFolderPathIndex.mockResolvedValue({
      rowById: new Map([['fld-1', { id: 'fld-1', name: 'Locked', parentId: null }]]),
      pathById: new Map([['fld-1', '/Locked']]),
      idByPath: new Map([['/Locked', 'fld-1']]),
    })
    mockPerformCreateWorkflow.mockResolvedValue({ success: true, workflow: CREATED })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPost(VALID_BODY)

    expect(res.status).toBe(404)
    expect(mockPerformCreateWorkflow).not.toHaveBeenCalled()
  })

  it('400s when name is missing', async () => {
    const res = await callPost({ workspaceId: 'workspace-1' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformCreateWorkflow).not.toHaveBeenCalled()
  })

  it('400s on an unknown body field', async () => {
    const res = await callPost({ ...VALID_BODY, sortOrder: 3 })
    expect(res.status).toBe(400)
    expect(mockPerformCreateWorkflow).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue(ACCESS_DENIED)
    const res = await callPost(VALID_BODY)
    expect(res.status).toBe(403)
    expect(mockPerformCreateWorkflow).not.toHaveBeenCalled()
  })

  it('requires write access on the target workspace', async () => {
    await callPost(VALID_BODY)
    expect(mockResolveWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'workspace-1',
      'write'
    )
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPost(VALID_BODY)
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('423s when the destination folder is locked', async () => {
    mockAssertFolderMutable.mockRejectedValue(new FolderLockedErrorMock('Folder is locked'))
    const res = await callPost({ ...VALID_BODY, folderPath: '/Locked' })
    expect(res.status).toBe(423)
    expect((await res.json()).error.code).toBe('LOCKED')
    expect(mockPerformCreateWorkflow).not.toHaveBeenCalled()
  })

  it('404s a path outside the workspace without ever reading its lock state', async () => {
    const res = await callPost({ ...VALID_BODY, folderPath: '/Elsewhere' })

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockAssertFolderMutable).not.toHaveBeenCalled()
    expect(mockPerformCreateWorkflow).not.toHaveBeenCalled()
  })

  it('resolves the canonical path before checking mutability', async () => {
    await callPost({ ...VALID_BODY, folderPath: '/Locked' })

    expect(mockLoadActiveFolderPathIndex).toHaveBeenCalledWith(
      'workspace-1',
      'workflow',
      expect.any(Object)
    )
    expect(mockAssertFolderMutable).toHaveBeenCalledWith('fld-1')
  })

  it('skips the containment check when no folder is supplied', async () => {
    await callPost(VALID_BODY)
    expect(mockAssertFolderMutable).toHaveBeenCalledWith(null)
  })

  it('409s when the name is already taken in the target folder', async () => {
    mockPerformCreateWorkflow.mockResolvedValue({
      success: false,
      error: 'A workflow named "Support Agent" already exists in this folder',
      errorCode: 'conflict',
    })
    const res = await callPost(VALID_BODY)
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })

  it('creates the workflow and returns 201 with the public shape', async () => {
    const res = await callPost(VALID_BODY)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body).toEqual({
      data: {
        id: 'wf-1',
        name: 'Support Agent',
        description: 'Handles tickets',
        folderPath: '/',
        workspaceId: 'workspace-1',
        isDeployed: false,
        deployedAt: null,
        runCount: 0,
        lastRunAt: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    })
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99')
    expect(mockPerformCreateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        name: 'Support Agent',
        description: 'Handles tickets',
        folderId: null,
      })
    )
  })
})
