import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { executeOracleFusionHcmTool } from '@/lib/internal/oracle-fusion-hcm/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const TEST_ACCESS_TOKEN = 'test-access-token'

const mocks = vi.hoisted(() => ({
  createAssignedPayroll: vi.fn(),
  updateAssignedPayroll: vi.fn(),
  createElementEntry: vi.fn(),
  updateElementEntryValue: vi.fn(),
  createSalary: vi.fn(),
  correctSalary: vi.fn(),
  createTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  listWorkers: vi.fn(),
  getWorker: vi.fn(),
  listWorkerAssignments: vi.fn(),
  getWorkerAssignment: vi.fn(),
  listWorkerManagers: vi.fn(),
  listWorkerDirectReports: vi.fn(),
  listAbsences: vi.fn(),
  getAbsence: vi.fn(),
  listAbsenceTypes: vi.fn(),
  listJobs: vi.fn(),
  listJobFamilies: vi.fn(),
  listDepartments: vi.fn(),
  listLocations: vi.fn(),
  listPositions: vi.fn(),
  listBusinessUnits: vi.fn(),
  listLegalEmployers: vi.fn(),
  listGrades: vi.fn(),
  listPersonTypes: vi.fn(),
}))

vi.mock('@/lib/internal/oracle-fusion-hcm/operations', () => ({
  executeOracleFusionHcmCreateAssignedPayroll: mocks.createAssignedPayroll,
  executeOracleFusionHcmUpdateAssignedPayroll: mocks.updateAssignedPayroll,
  executeOracleFusionHcmCreateElementEntry: mocks.createElementEntry,
  executeOracleFusionHcmUpdateElementEntryValue: mocks.updateElementEntryValue,
  executeOracleFusionHcmCreateSalary: mocks.createSalary,
  executeOracleFusionHcmCorrectSalary: mocks.correctSalary,
  executeOracleFusionHcmCreateTimeEntry: mocks.createTimeEntry,
  executeOracleFusionHcmUpdateTimeEntry: mocks.updateTimeEntry,
  executeOracleFusionHcmDeleteTimeEntry: mocks.deleteTimeEntry,
  executeOracleFusionHcmListWorkers: mocks.listWorkers,
  executeOracleFusionHcmGetWorker: mocks.getWorker,
  executeOracleFusionHcmListWorkerAssignments: mocks.listWorkerAssignments,
  executeOracleFusionHcmGetWorkerAssignment: mocks.getWorkerAssignment,
  executeOracleFusionHcmListWorkerManagers: mocks.listWorkerManagers,
  executeOracleFusionHcmListWorkerDirectReports: mocks.listWorkerDirectReports,
  executeOracleFusionHcmListAbsences: mocks.listAbsences,
  executeOracleFusionHcmGetAbsence: mocks.getAbsence,
  executeOracleFusionHcmListAbsenceTypes: mocks.listAbsenceTypes,
  executeOracleFusionHcmListJobs: mocks.listJobs,
  executeOracleFusionHcmListJobFamilies: mocks.listJobFamilies,
  executeOracleFusionHcmListDepartments: mocks.listDepartments,
  executeOracleFusionHcmListLocations: mocks.listLocations,
  executeOracleFusionHcmListPositions: mocks.listPositions,
  executeOracleFusionHcmListBusinessUnits: mocks.listBusinessUnits,
  executeOracleFusionHcmListLegalEmployers: mocks.listLegalEmployers,
  executeOracleFusionHcmListGrades: mocks.listGrades,
  executeOracleFusionHcmListPersonTypes: mocks.listPersonTypes,
}))

const auth = {
  instanceUrl: 'https://acme.fa.ocs.oraclecloud.com',
  accessToken: TEST_ACCESS_TOKEN,
}

function invokeHcmTool(overrides: Partial<InternalToolOperationCall>) {
  return executeOracleFusionHcmTool({
    toolId: 'oracle_fusion_hcm_list_workers',
    input: auth,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', userId: 'user-1' },
    requestId: 'request-1',
    ...overrides,
  })
}

describe('Oracle Fusion HCM tool dispatch', () => {
  it('turns an explicit model clear flag into a nullable element value before execution', async () => {
    const response = await invokeHcmTool({
      toolId: 'oracle_fusion_hcm_update_element_entry_value',
      input: {
        ...auth,
        elementEntryId: '1',
        elementEntryValueId: '2',
        effectiveDate: '2026-01-01',
        rangeMode: 'CORRECTION',
        clearScreenEntryValue: true,
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.updateElementEntryValue).toHaveBeenCalledWith(
      expect.objectContaining({ screenEntryValue: null }),
      undefined
    )
  })

  it('marks ambiguous mutation failures non-retryable without exposing provider details', async () => {
    mocks.createSalary.mockRejectedValueOnce(
      new OracleFusionProviderError('Oracle Fusion HCM request timed out', 504)
    )
    const response = await invokeHcmTool({
      toolId: 'oracle_fusion_hcm_create_salary',
      input: {
        ...auth,
        assignmentId: '1',
        salaryBasisId: '2',
        salaryAmount: 1200,
        dateFrom: '2026-01-01',
        dateTo: '4712-12-31',
      },
    })
    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Oracle Fusion HCM request timed out',
      retryable: false,
    })
    expect(mocks.createSalary).toHaveBeenCalledOnce()
  })

  it('rejects a time update missing its version before dispatch', async () => {
    const response = await invokeHcmTool({
      toolId: 'oracle_fusion_hcm_update_time_entry',
      input: {
        ...auth,
        personNumber: '0007',
        timeRecordId: '2',
        measure: 8,
        referenceDate: '2026-01-01',
      },
    })
    expect(response.status).toBe(400)
    expect(mocks.updateTimeEntry).not.toHaveBeenCalled()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    for (const mock of Object.values(mocks)) {
      mock.mockResolvedValue({ success: true, output: {} })
    }
  })

  it.each([
    ['oracle_fusion_hcm_list_workers', mocks.listWorkers, {}],
    ['oracle_fusion_hcm_get_worker', mocks.getWorker, { personId: '1' }],
    ['oracle_fusion_hcm_list_worker_assignments', mocks.listWorkerAssignments, { personId: '1' }],
    [
      'oracle_fusion_hcm_get_worker_assignment',
      mocks.getWorkerAssignment,
      { personId: '1', assignmentId: '2' },
    ],
    [
      'oracle_fusion_hcm_list_worker_managers',
      mocks.listWorkerManagers,
      { personId: '1', assignmentId: '2' },
    ],
    [
      'oracle_fusion_hcm_list_worker_direct_reports',
      mocks.listWorkerDirectReports,
      { personId: '1', assignmentId: '2' },
    ],
    ['oracle_fusion_hcm_list_absences', mocks.listAbsences, { personId: '1' }],
    ['oracle_fusion_hcm_get_absence', mocks.getAbsence, { absenceId: '3' }],
    ['oracle_fusion_hcm_list_absence_types', mocks.listAbsenceTypes, { personId: '1' }],
    ['oracle_fusion_hcm_list_jobs', mocks.listJobs, {}],
    ['oracle_fusion_hcm_list_job_families', mocks.listJobFamilies, {}],
    ['oracle_fusion_hcm_list_departments', mocks.listDepartments, {}],
    ['oracle_fusion_hcm_list_locations', mocks.listLocations, {}],
    ['oracle_fusion_hcm_list_positions', mocks.listPositions, {}],
    ['oracle_fusion_hcm_list_business_units', mocks.listBusinessUnits, {}],
    ['oracle_fusion_hcm_list_legal_employers', mocks.listLegalEmployers, {}],
    ['oracle_fusion_hcm_list_grades', mocks.listGrades, {}],
    ['oracle_fusion_hcm_list_person_types', mocks.listPersonTypes, {}],
  ])('dispatches %s', async (toolId, operation, extra) => {
    const response = await invokeHcmTool({ toolId, input: { ...auth, ...extra } })
    expect(response.status).toBe(200)
    expect(operation).toHaveBeenCalledOnce()
  })

  it('rejects cross-field absence validation before dispatch', async () => {
    const response = await invokeHcmTool({
      toolId: 'oracle_fusion_hcm_list_absences',
      input: { ...auth, personId: '1', startDate: '2026-01-01' },
    })
    expect(response.status).toBe(400)
    expect(mocks.listAbsences).not.toHaveBeenCalled()
  })

  it('propagates cancellation that occurs while an operation resolves', async () => {
    const controller = new AbortController()
    mocks.listWorkers.mockImplementationOnce(async () => {
      controller.abort(new Error('caller stopped'))
      return { success: true, output: {} }
    })

    await expect(
      invokeHcmTool({
        toolId: 'oracle_fusion_hcm_list_workers',
        input: auth,
        signal: controller.signal,
      })
    ).rejects.toThrow('caller stopped')
  })

  it('maps operation errors and rejects unknown tools', async () => {
    mocks.getWorker.mockRejectedValueOnce(new OracleFusionProviderError('denied', 403))
    const denied = await invokeHcmTool({
      toolId: 'oracle_fusion_hcm_get_worker',
      input: { ...auth, personId: '1' },
    })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ success: false, error: 'denied' })

    const unknown = await invokeHcmTool({
      toolId: 'oracle_fusion_hcm_nope',
      input: auth,
    })
    expect(unknown.status).toBe(500)
  })

  it('does not reflect unexpected error messages', async () => {
    mocks.listWorkers.mockRejectedValueOnce(new Error('secret provider detail'))
    const response = await invokeHcmTool({
      toolId: 'oracle_fusion_hcm_list_workers',
      input: auth,
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Oracle Fusion HCM request failed',
    })
  })
})
