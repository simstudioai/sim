/**
 * @vitest-environment node
 */
import { hybridAuthMockFns, workflowAuthzMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockAddWorkflowGroup, mockUpdateWorkflowGroup } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockAddWorkflowGroup: vi.fn(),
  mockUpdateWorkflowGroup: vi.fn(),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    accessError: (result: { status: number }) =>
      NextResponse.json({ error: 'denied' }, { status: result.status }),
    checkAccess: mockCheckAccess,
    normalizeColumn: (column: unknown) => column,
  }
})

vi.mock('@/lib/table/workflow-groups/service', () => ({
  addWorkflowGroup: mockAddWorkflowGroup,
  updateWorkflowGroup: mockUpdateWorkflowGroup,
  deleteWorkflowGroup: vi.fn(),
}))

import { PATCH, POST } from '@/app/api/table/[tableId]/groups/route'

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: { columns: [] },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function callPost(body: Record<string, unknown>, tableId = 'tbl_1') {
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/groups`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return POST(req, { params: Promise.resolve({ tableId }) })
}

function callPatch(body: Record<string, unknown>, tableId = 'tbl_1') {
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/groups`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return PATCH(req, { params: Promise.resolve({ tableId }) })
}

const baseGroup = {
  id: 'grp_1',
  workflowId: 'wf_1',
  outputs: [{ blockId: 'block_1', path: 'result', columnName: 'result' }],
}

const baseOutputColumns = [{ name: 'result', type: 'string', workflowGroupId: 'grp_1' }]

describe('POST /api/table/[tableId]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    workflowAuthzMockFns.mockGetActiveWorkflowContext.mockResolvedValue({
      workflow: { id: 'wf_1' },
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
    })
    mockAddWorkflowGroup.mockResolvedValue({
      schema: { columns: baseOutputColumns, workflowGroups: [baseGroup] },
    })
  })

  it('rejects a workflowId belonging to a different workspace', async () => {
    workflowAuthzMockFns.mockGetActiveWorkflowContext.mockResolvedValue({
      workflow: { id: 'wf_1' },
      workspaceId: 'other-workspace',
      workspaceOrganizationId: null,
    })
    const res = await callPost({
      workspaceId: 'workspace-1',
      group: baseGroup,
      outputColumns: baseOutputColumns,
    })
    expect(res.status).toBe(400)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('rejects a nonexistent workflowId', async () => {
    workflowAuthzMockFns.mockGetActiveWorkflowContext.mockResolvedValue(null)
    const res = await callPost({
      workspaceId: 'workspace-1',
      group: baseGroup,
      outputColumns: baseOutputColumns,
    })
    expect(res.status).toBe(400)
    expect(mockAddWorkflowGroup).not.toHaveBeenCalled()
  })

  it('succeeds when the workflow belongs to the same workspace', async () => {
    const res = await callPost({
      workspaceId: 'workspace-1',
      group: baseGroup,
      outputColumns: baseOutputColumns,
    })
    expect(res.status).toBe(200)
    expect(mockAddWorkflowGroup).toHaveBeenCalled()
  })

  it('skips the workflow check for enrichment groups without a workflowId', async () => {
    const res = await callPost({
      workspaceId: 'workspace-1',
      group: { ...baseGroup, workflowId: '', enrichmentId: 'enrich_1' },
      outputColumns: baseOutputColumns,
    })
    expect(res.status).toBe(200)
    expect(workflowAuthzMockFns.mockGetActiveWorkflowContext).not.toHaveBeenCalled()
    expect(mockAddWorkflowGroup).toHaveBeenCalled()
  })
})

describe('PATCH /api/table/[tableId]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    workflowAuthzMockFns.mockGetActiveWorkflowContext.mockResolvedValue({
      workflow: { id: 'wf_1' },
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
    })
    mockUpdateWorkflowGroup.mockResolvedValue({
      schema: { columns: baseOutputColumns, workflowGroups: [baseGroup] },
    })
  })

  it('rejects changing workflowId to one in a different workspace', async () => {
    workflowAuthzMockFns.mockGetActiveWorkflowContext.mockResolvedValue({
      workflow: { id: 'wf_2' },
      workspaceId: 'other-workspace',
      workspaceOrganizationId: null,
    })
    const res = await callPatch({
      workspaceId: 'workspace-1',
      groupId: 'grp_1',
      workflowId: 'wf_2',
    })
    expect(res.status).toBe(400)
    expect(mockUpdateWorkflowGroup).not.toHaveBeenCalled()
  })

  it('rejects a nonexistent workflowId', async () => {
    workflowAuthzMockFns.mockGetActiveWorkflowContext.mockResolvedValue(null)
    const res = await callPatch({
      workspaceId: 'workspace-1',
      groupId: 'grp_1',
      workflowId: 'wf_missing',
    })
    expect(res.status).toBe(400)
    expect(mockUpdateWorkflowGroup).not.toHaveBeenCalled()
  })

  it('succeeds when changing workflowId to one in the same workspace', async () => {
    const res = await callPatch({
      workspaceId: 'workspace-1',
      groupId: 'grp_1',
      workflowId: 'wf_1',
    })
    expect(res.status).toBe(200)
    expect(mockUpdateWorkflowGroup).toHaveBeenCalled()
  })

  it('skips the workflow check when workflowId is not being changed', async () => {
    const res = await callPatch({
      workspaceId: 'workspace-1',
      groupId: 'grp_1',
      name: 'Renamed group',
    })
    expect(res.status).toBe(200)
    expect(workflowAuthzMockFns.mockGetActiveWorkflowContext).not.toHaveBeenCalled()
    expect(mockUpdateWorkflowGroup).toHaveBeenCalled()
  })
})
