import {
  createTableDefinition,
  hybridAuthMockFns,
  resetEnvFlagsMock,
  setEnvFlags,
  type TableDefinitionFactoryOptions,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { asyncJobsRegionMock } from '@sim/testing/mocks/async-jobs-region.mock'
import { backgroundTaskMock, backgroundTaskMockFns } from '@sim/testing/mocks/background-task.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  tableJobsServiceMock,
  tableJobsServiceMockFns,
} from '@sim/testing/mocks/table-jobs-service.mock'
import {
  tableRouteUtilsMock,
  tableRouteUtilsMockFns,
} from '@sim/testing/mocks/table-route-utils.mock'
import { tasks } from '@trigger.dev/sdk'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRunTableDelete } = vi.hoisted(() => ({
  mockRunTableDelete: vi.fn(),
}))

vi.mock('@sim/utils/id', () => idMock)
vi.mock('@/lib/table/jobs/service', () => tableJobsServiceMock)
vi.mock('@/lib/table/delete-runner', () => ({ runTableDelete: mockRunTableDelete }))
vi.mock('@/background/table-delete', () => ({ tableDeleteTask: { id: 'table-delete' } }))
vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)
vi.mock('@/app/api/table/utils', () => tableRouteUtilsMock)

import { POST } from '@/app/api/table/[tableId]/delete-async/route'

const { mockMarkTableJobRunning, mockReleaseJobClaim } = tableJobsServiceMockFns
const { mockCheckAccess, mockTableFilterError } = tableRouteUtilsMockFns

const mockTasksTrigger = vi.mocked(tasks.trigger)

backgroundTaskMockFns.mockRunDetached.mockImplementation(
  (_label: string, work: () => Promise<unknown>) => {
    void work()
  }
)
idMockFns.mockGenerateId.mockReturnValue('job-id-xyz')
idMockFns.mockGenerateShortId.mockReturnValue('short-id')

afterAll(resetEnvFlagsMock)

const TABLE_FIXTURE: TableDefinitionFactoryOptions = {
  columns: [{ name: 'status', type: 'string' }],
  rowCount: 1000,
}

function makeRequest(body: unknown, tableId = 'tbl_1') {
  const req = createMockRequest({
    method: 'POST',
    url: `/api/table/${tableId}/delete-async`,
    headers: { 'content-type': 'application/json' },
    body,
  })
  return POST(req, createRouteContext({ tableId }))
}

const validBody = {
  workspaceId: 'workspace-1',
  filter: { status: 'archived' },
  excludeRowIds: ['row_keep'],
}

describe('POST /api/table/[tableId]/delete-async', () => {
  beforeEach(() => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: createTableDefinition(TABLE_FIXTURE) })
    mockMarkTableJobRunning.mockResolvedValue(true)
    mockRunTableDelete.mockResolvedValue(undefined)
    mockTableFilterError.mockReturnValue(null)
    mockTasksTrigger.mockResolvedValue({ id: 'run_1' })
    setEnvFlags({ isTriggerDevEnabled: false })
  })

  it('returns 409 when a job is already in progress (claim lost)', async () => {
    mockMarkTableJobRunning.mockResolvedValue(false)
    const response = await makeRequest(validBody)
    expect(response.status).toBe(409)
    expect(mockRunTableDelete).not.toHaveBeenCalled()
  })

  it('releases the job claim when the trigger.dev dispatch fails (no ghost running job)', async () => {
    setEnvFlags({ isTriggerDevEnabled: true })
    mockTasksTrigger.mockRejectedValueOnce(new Error('trigger.dev unreachable'))

    const response = await makeRequest(validBody)

    expect(response.status).toBe(500)
    expect(mockReleaseJobClaim).toHaveBeenCalledWith('tbl_1', 'job-id-xyz')
    expect(mockRunTableDelete).not.toHaveBeenCalled()
  })

  /**
   * PR #6067 review finding (greptile P1 / bugbot High): a hybrid filter — group
   * key AND leaf keys on one node — passes the dual-grammar union via the
   * non-stripping legacy branch, and the downgrade used to convert group-first,
   * silently dropping the leaf and WIDENING an async select-all delete.
   */
  it('rejects a hybrid group+leaf filter with 400 instead of widening the delete', async () => {
    const response = await makeRequest({
      workspaceId: 'workspace-1',
      filter: {
        all: [{ field: 'tenant_id', op: 'eq', value: 'acme' }],
        field: 'status',
        op: 'eq',
        value: 'archived',
      },
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/not both/)
  })
})
