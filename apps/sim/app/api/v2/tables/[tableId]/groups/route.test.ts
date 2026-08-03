/**
 * @vitest-environment node
 *
 * Public v2 workflow-group listing — a read-only projection of the table's
 * schema, exposed so a caller can discover the group ids the run endpoints
 * take.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockGateError,
  mockAddWorkflowGroup,
  mockUpdateWorkflowGroup,
  mockDeleteWorkflowGroup,
  mockGetActiveWorkflowContext,
  mockSignalSchemaChanged,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockGateError: vi.fn(),
  mockAddWorkflowGroup: vi.fn(),
  mockUpdateWorkflowGroup: vi.fn(),
  mockDeleteWorkflowGroup: vi.fn(),
  mockGetActiveWorkflowContext: vi.fn(),
  mockSignalSchemaChanged: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/app/api/table/utils', () => ({
  checkAccess: mockCheckAccess,
  normalizeColumn: (col: Record<string, unknown>) => col,
  rootErrorMessage: (error: unknown) => String(error),
  rowWriteErrorResponse: () => null,
}))

vi.mock('@/lib/table/workflow-groups/service', () => ({
  addWorkflowGroup: mockAddWorkflowGroup,
  updateWorkflowGroup: mockUpdateWorkflowGroup,
  deleteWorkflowGroup: mockDeleteWorkflowGroup,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  getActiveWorkflowContext: mockGetActiveWorkflowContext,
}))

vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: mockSignalSchemaChanged }))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { DELETE, GET, PATCH, POST } from '@/app/api/v2/tables/[tableId]/groups/route'

const GROUP = {
  id: 'group-1',
  workflowId: 'wf-1',
  name: 'Enrich',
  outputs: [{ blockId: 'blk-1', path: 'content', columnName: 'summary' }],
}
const TABLE = {
  id: 'table-1',
  workspaceId: 'ws-1',
  schema: { columns: [], workflowGroups: [GROUP] },
}

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  workspaceId: 'ws-1',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

function callGet() {
  const req = new NextRequest(
    'http://localhost:3000/api/v2/tables/table-1/groups?workspaceId=ws-1',
    { method: 'GET' }
  )
  return GET(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

describe('GET /api/v2/tables/[tableId]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockGateError.mockResolvedValue(null)
  })

  it('returns the schema groups as one full page', async () => {
    const res = await callGet()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [GROUP], nextCursor: null })
  })

  it('returns an empty page for a table with no groups', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: { ...TABLE, schema: { columns: [] } } })

    const res = await callGet()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [], nextCursor: null })
  })

  it('masks a permission failure as 404 so table existence never leaks', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callGet()

    expect(res.status).toBe(404)
  })

  it('400s a request with no workspaceId', async () => {
    const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/groups', {
      method: 'GET',
    })
    const res = await GET(req, { params: Promise.resolve({ tableId: 'table-1' }) })

    expect(res.status).toBe(400)
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    })

    const res = await callGet()

    expect(res.status).toBe(429)
    expect(mockCheckAccess).not.toHaveBeenCalled()
  })
})

const ADD_BODY = {
  workspaceId: 'ws-1',
  group: {
    workflowId: 'wf-1',
    outputs: [{ blockId: 'blk-1', path: 'content', columnName: 'summary' }],
  },
  outputColumns: [{ name: 'summary', type: 'string' }],
}

const UPDATED_TABLE = {
  id: 'table-1',
  workspaceId: 'ws-1',
  schema: { columns: [{ name: 'summary', type: 'string' }], workflowGroups: [GROUP] },
}

function callWrite(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/groups', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const handler = method === 'POST' ? POST : method === 'PATCH' ? PATCH : DELETE
  return handler(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

describe('POST /api/v2/tables/[tableId]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockGateError.mockResolvedValue(null)
    mockGetActiveWorkflowContext.mockResolvedValue({ workspaceId: 'ws-1' })
    // Echo back the id the route generated, as the real service does.
    mockAddWorkflowGroup.mockImplementation(async (data: { group: { id: string } }) => ({
      ...UPDATED_TABLE,
      schema: {
        ...UPDATED_TABLE.schema,
        workflowGroups: [{ ...GROUP, id: data.group.id }],
      },
    }))
  })

  it('creates the group and its columns, returning both', async () => {
    const res = await callWrite('POST', ADD_BODY)

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.group).toMatchObject({ workflowId: 'wf-1', name: 'Enrich' })
    expect(body.data.columns).toEqual([{ name: 'summary', type: 'string' }])
    expect(mockSignalSchemaChanged).toHaveBeenCalledWith('table-1')
  })

  it('500s rather than emitting a body without the group it claims to have written', async () => {
    // Write reports success but the group is absent — an internal inconsistency
    // must not surface as a 200 with `group: undefined`.
    mockAddWorkflowGroup.mockResolvedValue({
      ...UPDATED_TABLE,
      schema: { columns: [], workflowGroups: [] },
    })

    const res = await callWrite('POST', ADD_BODY)

    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('INTERNAL_ERROR')
  })

  it('server-generates the group id and stamps it onto the output columns', async () => {
    await callWrite('POST', ADD_BODY)

    const call = mockAddWorkflowGroup.mock.calls[0][0]
    expect(call.group.id).toEqual(expect.any(String))
    expect(call.group.id).not.toBe('')
    // The caller never supplies workflowGroupId — it is derived from the group.
    expect(call.outputColumns[0].workflowGroupId).toBe(call.group.id)
  })

  it('defaults autoRun to false so one POST cannot fan out a metered backfill', async () => {
    await callWrite('POST', ADD_BODY)
    expect(mockAddWorkflowGroup.mock.calls[0][0].autoRun).toBe(false)
  })

  it('rejects a workflow from another workspace before persisting it', async () => {
    mockGetActiveWorkflowContext.mockResolvedValue({ workspaceId: 'ws-other' })

    const res = await callWrite('POST', ADD_BODY)

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('Workflow not found')
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('rejects an output column that no group output feeds', async () => {
    const res = await callWrite('POST', {
      ...ADD_BODY,
      outputColumns: [{ name: 'summry', type: 'string' }],
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('summry')
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('400s an enrichment group with no enrichmentId', async () => {
    const res = await callWrite('POST', {
      ...ADD_BODY,
      group: { ...ADD_BODY.group, workflowId: '', type: 'enrichment' },
    })

    expect(res.status).toBe(400)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('400s a workflow group with no workflowId', async () => {
    const res = await callWrite('POST', {
      ...ADD_BODY,
      group: { ...ADD_BODY.group, workflowId: '' },
    })

    expect(res.status).toBe(400)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('masks a permission failure as 404', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callWrite('POST', ADD_BODY)

    expect(res.status).toBe(404)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callWrite('POST', ADD_BODY)

    expect(res.status).toBe(404)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({ ...RATE_LIMIT_OK, allowed: false, retryAfterMs: 1000 })

    const res = await callWrite('POST', ADD_BODY)

    expect(res.status).toBe(429)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('surfaces a duplicate-column failure as 400, not 500', async () => {
    mockAddWorkflowGroup.mockRejectedValue(new Error('Column "summary" already exists'))

    const res = await callWrite('POST', ADD_BODY)

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain('already exists')
  })
})

describe('PATCH /api/v2/tables/[tableId]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockGateError.mockResolvedValue(null)
    mockGetActiveWorkflowContext.mockResolvedValue({ workspaceId: 'ws-1' })
    mockUpdateWorkflowGroup.mockResolvedValue(UPDATED_TABLE)
  })

  it('updates the group and returns it with the resulting columns', async () => {
    const res = await callWrite('PATCH', {
      workspaceId: 'ws-1',
      groupId: 'group-1',
      name: 'Renamed',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.group).toEqual(GROUP)
    expect(body.data.columns).toEqual([{ name: 'summary', type: 'string' }])
    expect(mockUpdateWorkflowGroup).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 'table-1', groupId: 'group-1', name: 'Renamed' }),
      expect.any(String)
    )
  })

  it('re-checks workspace containment when the group is re-pointed', async () => {
    mockGetActiveWorkflowContext.mockResolvedValue({ workspaceId: 'ws-other' })

    const res = await callWrite('PATCH', {
      workspaceId: 'ws-1',
      groupId: 'group-1',
      workflowId: 'wf-elsewhere',
    })

    expect(res.status).toBe(400)
    expect(mockUpdateWorkflowGroup).not.toHaveBeenCalled()
  })

  it('stamps the group id onto any newly added output columns', async () => {
    await callWrite('PATCH', {
      workspaceId: 'ws-1',
      groupId: 'group-1',
      newOutputColumns: [{ name: 'score', type: 'number' }],
    })

    expect(mockUpdateWorkflowGroup.mock.calls[0][0].newOutputColumns[0].workflowGroupId).toBe(
      'group-1'
    )
  })

  it('masks a permission failure as 404', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callWrite('PATCH', { workspaceId: 'ws-1', groupId: 'group-1' })

    expect(res.status).toBe(404)
    expect(mockUpdateWorkflowGroup).not.toHaveBeenCalled()
  })

  it('404s an unknown group rather than reporting a generic failure', async () => {
    mockUpdateWorkflowGroup.mockRejectedValue(new Error('Workflow group not found'))

    const res = await callWrite('PATCH', { workspaceId: 'ws-1', groupId: 'nope' })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v2/tables/[tableId]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceScope.mockResolvedValue(null)
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockGateError.mockResolvedValue(null)
    mockDeleteWorkflowGroup.mockResolvedValue({
      ...UPDATED_TABLE,
      schema: { columns: [], workflowGroups: [] },
    })
  })

  it('deletes the group and reports the surviving columns', async () => {
    const res = await callWrite('DELETE', { workspaceId: 'ws-1', groupId: 'group-1' })

    expect(res.status).toBe(200)
    // The group's columns go with it — the caller sees what is left, not a bare ack.
    expect(await res.json()).toEqual({ data: { id: 'group-1', deleted: true, columns: [] } })
    expect(mockDeleteWorkflowGroup).toHaveBeenCalledWith(
      { tableId: 'table-1', groupId: 'group-1' },
      expect.any(String)
    )
  })

  it('masks a permission failure as 404', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callWrite('DELETE', { workspaceId: 'ws-1', groupId: 'group-1' })

    expect(res.status).toBe(404)
    expect(mockDeleteWorkflowGroup).not.toHaveBeenCalled()
  })

  it('400s a body with no groupId', async () => {
    const res = await callWrite('DELETE', { workspaceId: 'ws-1' })

    expect(res.status).toBe(400)
    expect(mockDeleteWorkflowGroup).not.toHaveBeenCalled()
  })
})
