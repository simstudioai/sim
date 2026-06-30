/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const {
  mockCheckAccess,
  mockMarkTableJobRunning,
  mockReleaseJobClaim,
  mockRunTableDelete,
  mockTableFilterError,
  mockTasksTrigger,
  flags,
} = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockMarkTableJobRunning: vi.fn(),
  mockReleaseJobClaim: vi.fn(),
  mockRunTableDelete: vi.fn(),
  mockTableFilterError: vi.fn(),
  mockTasksTrigger: vi.fn(),
  flags: { triggerDev: false },
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('job-id-xyz'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))
vi.mock('@/lib/table/jobs/service', () => ({
  markTableJobRunning: mockMarkTableJobRunning,
  releaseJobClaim: mockReleaseJobClaim,
}))
vi.mock('@/lib/table/delete-runner', () => ({ runTableDelete: mockRunTableDelete }))
vi.mock('@/lib/core/config/env-flags', () => ({
  get isTriggerDevEnabled() {
    return flags.triggerDev
  },
}))
vi.mock('@/background/table-delete', () => ({ tableDeleteTask: { id: 'table-delete' } }))
vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: vi.fn().mockResolvedValue('us-east-1'),
}))
vi.mock('@trigger.dev/sdk', () => ({
  tasks: { trigger: mockTasksTrigger },
  task: (config: unknown) => config,
}))
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
    tableFilterError: mockTableFilterError,
  }
})

import { POST } from '@/app/api/table/[tableId]/delete-async/route'

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: { columns: [{ name: 'status', type: 'string' }] },
    metadata: null,
    rowCount: 1000,
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
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/delete-async`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ tableId }) })
}

const validBody = {
  workspaceId: 'workspace-1',
  filter: { status: 'archived' },
  excludeRowIds: ['row_keep'],
}

describe('POST /api/table/[tableId]/delete-async', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockMarkTableJobRunning.mockResolvedValue(true)
    mockRunTableDelete.mockResolvedValue(undefined)
    mockTableFilterError.mockReturnValue(null)
    mockTasksTrigger.mockResolvedValue({ id: 'run_1' })
    flags.triggerDev = false
  })

  it('claims the job slot and kicks off the delete worker with filter + exclusions', async () => {
    const response = await makeRequest(validBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual({ tableId: 'tbl_1', jobId: 'job-id-xyz' })
    expect(mockMarkTableJobRunning).toHaveBeenCalledWith('tbl_1', 'job-id-xyz', 'delete', {
      filter: { status: 'archived' },
      excludeRowIds: ['row_keep'],
      cutoff: expect.any(String),
    })
    expect(mockRunTableDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-id-xyz',
        tableId: 'tbl_1',
        workspaceId: 'workspace-1',
        filter: { status: 'archived' },
        excludeRowIds: ['row_keep'],
        cutoff: expect.any(Date),
      })
    )
  })

  it('allows a whole-table delete with no filter', async () => {
    const response = await makeRequest({ workspaceId: 'workspace-1' })
    expect(response.status).toBe(200)
    expect(mockRunTableDelete).toHaveBeenCalledWith(
      expect.objectContaining({ filter: undefined, cutoff: expect.any(Date) })
    )
  })

  it('returns 409 when a job is already in progress (claim lost)', async () => {
    mockMarkTableJobRunning.mockResolvedValue(false)
    const response = await makeRequest(validBody)
    expect(response.status).toBe(409)
    expect(mockRunTableDelete).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid filter without claiming the slot', async () => {
    mockTableFilterError.mockReturnValue(NextResponse.json({ error: 'bad field' }, { status: 400 }))
    const response = await makeRequest(validBody)
    expect(response.status).toBe(400)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
    expect(mockRunTableDelete).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(401)
    expect(mockMarkTableJobRunning).not.toHaveBeenCalled()
  })

  it('returns the access error status when access is denied', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(403)
    expect(mockRunTableDelete).not.toHaveBeenCalled()
  })

  it('returns 400 when the table is archived', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable({ archivedAt: new Date() }) })
    const response = await makeRequest(validBody)
    expect(response.status).toBe(400)
    expect(mockRunTableDelete).not.toHaveBeenCalled()
  })

  it('returns 400 on workspace mismatch', async () => {
    const response = await makeRequest({ ...validBody, workspaceId: 'other-ws' })
    expect(response.status).toBe(400)
  })

  it('routes through trigger.dev (ISO cutoff, tagged) when the flag is on', async () => {
    flags.triggerDev = true
    const response = await makeRequest(validBody)

    expect(response.status).toBe(200)
    expect(mockRunTableDelete).not.toHaveBeenCalled()
    expect(mockTasksTrigger).toHaveBeenCalledWith(
      'table-delete',
      expect.objectContaining({
        jobId: 'job-id-xyz',
        tableId: 'tbl_1',
        filter: { status: 'archived' },
        excludeRowIds: ['row_keep'],
        cutoff: expect.any(String),
      }),
      { tags: ['tableId:tbl_1', 'jobId:job-id-xyz'], region: 'us-east-1' }
    )
  })

  it('releases the job claim when the trigger.dev dispatch fails (no ghost running job)', async () => {
    flags.triggerDev = true
    mockTasksTrigger.mockRejectedValueOnce(new Error('trigger.dev unreachable'))

    const response = await makeRequest(validBody)

    expect(response.status).toBe(500)
    expect(mockReleaseJobClaim).toHaveBeenCalledWith('tbl_1', 'job-id-xyz')
    expect(mockRunTableDelete).not.toHaveBeenCalled()
  })
})
