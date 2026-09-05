/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ json: vi.fn(), empty: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.json,
  requestOracleFusionEmpty: mocks.empty,
}))

import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'
import {
  executeOracleFusionProjectManagementOperation as execute,
  type OracleFusionProjectManagementOperation,
} from '@/lib/internal/oracle-fusion-project-management/operations'

const auth = {
  oauthCredential: 'credential-1',
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://example.fa.us2.oraclecloud.com',
}

// Synthetic fixtures use the documented 26C property names and nullability.
// Each route below is independently pinned to Oracle's op-*-get.html pages.
const reads: Array<[OracleFusionProjectManagementOperation, Record<string, unknown>, string, Record<string, unknown>]> = [
  ['list_projects', {}, 'projects', { ProjectId: 101, ProjectName: 'Implementation' }],
  ['get_project', { projectId: '101' }, 'projects/101', { ProjectId: 101 }],
  ['list_project_plans', {}, 'projectPlanDetails', { ProjectId: 101, Name: 'Delivery' }],
  ['get_project_plan', { projectId: '101' }, 'projectPlanDetails/101', { ProjectId: 101 }],
  ['list_tasks', { projectId: '101' }, 'projectPlanDetails/101/child/Tasks', { TaskId: 202 }],
  ['get_task', { projectId: '101', taskId: '202' }, 'projectPlanDetails/101/child/Tasks/202', { TaskId: 202 }],
  ['list_project_statuses', {}, 'projectStatusesLOV', { ProjectStatusCode: 'APPROVED', StatusObjectCode: 'PROJECT' }],
  ['list_project_status_history', { projectId: '101' }, 'projects/101/child/ProjectStatusHistory', { StatusHistoryId: 303 }],
  ['list_task_status_history', { projectId: '101', taskId: '202' }, 'projectPlans/101/child/Tasks/202/child/StatusHistory', { StatusHistoryId: 303 }],
  ['list_deliverables', {}, 'deliverables', { DeliverableId: 404 }],
  ['get_deliverable', { deliverableId: '404' }, 'deliverables/404', { DeliverableId: 404 }],
  ['list_deliverable_task_associations', { deliverableId: '404' }, 'deliverables/404/child/ProjectTaskAssociation', { ObjectAssociationId: 505 }],
  ['get_deliverable_task_association', { deliverableId: '404', associationId: '505' }, 'deliverables/404/child/ProjectTaskAssociation/505', { ObjectAssociationId: 505 }],
  ['list_project_team_members', { projectId: '101' }, 'projects/101/child/ProjectTeamMembers', { TeamMemberId: 606 }],
  ['get_project_team_member', { projectId: '101', teamMemberId: '606' }, 'projects/101/child/ProjectTeamMembers/606', { TeamMemberId: 606 }],
  ['list_task_labor_resource_assignments', { projectId: '101' }, 'projectPlans/101/child/TaskLaborResourceAssignments', { TaskLaborResourceAssignmentId: 707 }],
  ['get_task_labor_resource_assignment', { projectId: '101', assignmentId: '707' }, 'projectPlans/101/child/TaskLaborResourceAssignments/707', { TaskLaborResourceAssignmentId: 707 }],
  ['list_project_enterprise_resources', {}, 'projectEnterpriseResources', { ResourceId: 808 }],
  ['list_project_budgets', {}, 'projectBudgets', { PlanVersionId: 909 }],
  ['get_project_budget', { planVersionId: '909' }, 'projectBudgets/909', { PlanVersionId: 909 }],
  ['list_project_contract_invoices', {}, 'projectContractInvoices', { InvoiceId: 110 }],
  ['get_project_contract_invoice', { invoiceId: '110' }, 'projectContractInvoices/110', { InvoiceId: 110 }],
]

function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return { items, count: items.length, limit: 100, offset: 0, hasMore: false, ...extra }
}

function sentBody(): string {
  return serializeOracleFusionJsonBody(mocks.json.mock.calls.at(-1)?.[1].body)
}

describe('Oracle Project Management documented operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.empty.mockResolvedValue(undefined)
  })

  it.each(reads)('%s uses its documented read resource', async (operation, params, path, record) => {
    mocks.json.mockResolvedValue(operation.startsWith('list_') ? page([record]) : record)
    const controller = new AbortController()
    expect((await execute(operation, { ...auth, ...params }, controller.signal)).success).toBe(true)
    expect(mocks.json).toHaveBeenCalledWith(
      { accessToken: auth.accessToken, instanceUrl: auth.instanceUrl },
      expect.objectContaining({ address: { family: 'fscm', relativePath: path }, method: 'GET' }),
      controller.signal
    )
  })

  it('preserves nullable fields and exact identifiers, while excluding unrequested payloads', async () => {
    mocks.json.mockResolvedValue({
      ProjectId: '9.99999999999999999E17', ProjectName: 'Implementation',
      ProjectDescription: null, ProjectDFF: [{ secret: 'canary' }], links: [],
    })
    expect(await execute('get_project', { ...auth, projectId: '999999999999999999' })).toEqual({
      success: true,
      output: { project: { ProjectId: '999999999999999999', ProjectName: 'Implementation', ProjectDescription: null } },
    })
  })

  it('returns the actual page and combines a project filter without fetching subsequent pages', async () => {
    mocks.json.mockResolvedValue(page([{ PlanVersionId: 909, PCRawCostAmounts: '9007199254740993' }], {
      limit: 25, offset: 50, hasMore: true, totalResults: 70,
    }))
    const result = await execute('list_project_budgets', {
      ...auth, projectId: '101', q: "PlanVersionStatus='Current Working'", limit: 25, offset: 50, totalResults: true,
    })
    expect(result.output).toEqual({
      items: [{ PlanVersionId: '909', PCRawCostAmounts: '9007199254740993' }],
      count: 1, limit: 25, offset: 50, nextOffset: 51, hasMore: true, totalResults: 70,
    })
    expect(mocks.json).toHaveBeenCalledTimes(1)
    expect(mocks.json.mock.calls[0][1].query).toMatchObject({
      q: "ProjectId=101 and (PlanVersionStatus='Current Working')", totalResults: true,
    })
  })

  it('reads milestones as a task filter and writes them with the milestone flag forced on', async () => {
    mocks.json.mockResolvedValueOnce(page([{ TaskId: 202, MilestoneFlag: true }]))
    await execute('list_milestones', { ...auth, projectId: '101', q: "Name like 'Release%'" })
    expect(mocks.json.mock.calls[0][1].query.q).toBe("MilestoneFlag=true and (Name like 'Release%')")
    mocks.json.mockResolvedValueOnce({ TaskId: 202, MilestoneFlag: true })
    await execute('create_milestone', { ...auth, projectId: '101', taskName: 'Release', taskNumber: 'M1', taskLevel: 1, milestoneFlag: false })
    expect(mocks.json.mock.calls[1][1].address.relativePath).toBe('projectPlans/101/child/Tasks')
    expect(JSON.parse(sentBody())).toEqual({ MilestoneFlag: true, Name: 'Release', TaskNumber: 'M1', TaskLevel: 1 })
  })

  it('serializes body IDs as exact numeric JSON tokens, never quoted strings or rounded numbers', async () => {
    mocks.json.mockResolvedValue({ ObjectAssociationId: '9007199254740993' })
    await execute('create_deliverable_task_association', { ...auth, deliverableId: '404', projectId: '999999999999999999', taskId: '9007199254740993' })
    expect(sentBody()).toBe('{"ProjectId":999999999999999999,"TaskId":9007199254740993}')
    expect(mocks.json.mock.calls[0][1]).toMatchObject({
      method: 'POST', mediaType: 'application/json',
      address: { family: 'fscm', relativePath: 'deliverables/404/child/ProjectTaskAssociation' },
    })
  })

  it.each([
    ['create_project', { projectName: 'Implementation', organizationName: 'Consulting' }, 'projects', { ProjectId: 101 }, { ProjectName: 'Implementation', OwningOrganizationName: 'Consulting' }],
    ['update_project', { projectId: '101', projectDescription: null }, 'projects/101', { ProjectId: 101 }, { ProjectDescription: null }],
    ['create_task', { projectId: '101', taskName: 'Design', taskNumber: 'T1', taskLevel: 1 }, 'projectPlans/101/child/Tasks', { TaskId: 202 }, { Name: 'Design', TaskNumber: 'T1', TaskLevel: 1 }],
    ['update_task', { projectId: '101', taskId: '202', physicalPercentComplete: 50, taskStatusCode: 'IN_PROGRESS' }, 'projectPlans/101/child/Tasks/202', { TaskId: 202 }, { PhysicalPercentComplete: 50, TaskStatusCode: 'IN_PROGRESS' }],
    ['create_deliverable', { deliverableName: 'Design', shortName: 'DES', deliverableTypeId: '1', deliverablePriorityCode: 'MEDIUM', deliverableStatusCode: 'NEW' }, 'deliverables', { DeliverableId: 404 }, { DeliverableName: 'Design', ShortName: 'DES', TypeId: 1, PriorityCode: 'MEDIUM', StatusCode: 'NEW' }],
    ['update_deliverable', { deliverableId: '404', needByDate: '2026-09-30' }, 'deliverables/404', { DeliverableId: 404 }, { NeedByDate: '2026-09-30' }],
    ['update_deliverable_task_association', { deliverableId: '404', associationId: '505', taskId: '203' }, 'deliverables/404/child/ProjectTaskAssociation/505', { ObjectAssociationId: 505 }, { TaskId: 203 }],
    ['create_project_team_member', { projectId: '101', personEmail: 'staff@example.test', projectRole: 'Project Manager' }, 'projects/101/child/ProjectTeamMembers', { TeamMemberId: 606 }, { PersonEmail: 'staff@example.test', ProjectRole: 'Project Manager' }],
    ['update_project_team_member', { projectId: '101', teamMemberId: '606', trackTimeFlag: false, personEmail: 'ignored@example.test', projectRole: 'Ignored' }, 'projects/101/child/ProjectTeamMembers/606', { TeamMemberId: 606 }, { TrackTimeFlag: false }],
    ['create_task_labor_resource_assignment', { projectId: '101', taskId: '202', resourceEmail: 'staff@example.test', plannedEffortinHours: 8 }, 'projectPlans/101/child/TaskLaborResourceAssignments', { TaskLaborResourceAssignmentId: 707 }, { TaskId: 202, ResourceEmail: 'staff@example.test', PlannedEffortinHours: 8 }],
    ['update_task_labor_resource_assignment', { projectId: '101', assignmentId: '707', laborResourceId: '808', primaryResourceFlag: false }, 'projectPlans/101/child/TaskLaborResourceAssignments/707', { TaskLaborResourceAssignmentId: 707 }, { LaborResourceId: 808, PrimaryResourceFlag: false }],
    ['update_project_budget', { planVersionId: '909', lockedFlag: false }, 'projectBudgets/909', { PlanVersionId: 909 }, { LockedFlag: false }],
    ['update_project_contract_invoice', { invoiceId: '110', invoiceComment: null }, 'projectContractInvoices/110', { InvoiceId: 110 }, { InvoiceComment: null }],
  ] as Array<[OracleFusionProjectManagementOperation, Record<string, unknown>, string, Record<string, unknown>, Record<string, unknown>]>)('%s sends only its documented writable fields', async (operation, params, path, response, body) => {
    mocks.json.mockResolvedValue(response)
    expect((await execute(operation, { ...auth, ...params })).success).toBe(true)
    expect(mocks.json.mock.calls[0][1]).toMatchObject({
      address: { family: 'fscm', relativePath: path },
      method: operation.startsWith('create_') ? 'POST' : 'PATCH',
      mediaType: 'application/json',
    })
    expect(JSON.parse(sentBody())).toEqual(body)
  })

  it('creates a budget with documented nested resource amounts and synchronous creation by default', async () => {
    mocks.json.mockResolvedValue({ PlanVersionId: 909 })
    await execute('create_project_budget', {
      ...auth, projectId: '101', projectName: 'Implementation', projectNumber: 'P1', planVersionName: 'Working',
      planningAmounts: 'Cost', planningResources: [{ RbsElementId: '999999999999999999', TaskId: '202', PlanningAmounts: [{ Currency: 'USD', RawCostAmounts: 125.5, Quantity: 2 }] }],
    })
    expect(sentBody()).toContain('"RbsElementId":999999999999999999')
    expect(JSON.parse(sentBody())).toMatchObject({ DeferFinancialPlanCreation: 'N', PlanningAmounts: 'Cost', PlanningResources: [{ TaskId: 202, PlanningAmounts: [{ Currency: 'USD', RawCostAmounts: 125.5, Quantity: 2 }] }] })
  })

  it.each(['Y', null])('rejects deferred or ambiguous budget creation (%s) before sending a request', async (deferFinancialPlanCreation) => {
    await expect(execute('create_project_budget', {
      ...auth,
      projectId: '101',
      projectName: 'Implementation',
      projectNumber: 'P1',
      planVersionName: 'Working',
      deferFinancialPlanCreation,
    })).rejects.toThrow('must be N')
    expect(mocks.json).not.toHaveBeenCalled()
  })

  it('keeps project cost self-link keys distinct from CostId for reads and rate updates', async () => {
    const record = { CostId: '9007199254740993', ExternalBillRate: 125.5, '@context': { links: [{ rel: 'self', href: `${auth.instanceUrl}/fscmRestApi/resources/11.13.18.05/projectCosts/opaque%2Bkey` }] } }
    mocks.json.mockResolvedValueOnce(page([record]))
    const result = await execute('list_project_costs', { ...auth, projectId: '101' })
    expect(result.output.items[0]).toEqual({ CostId: '9007199254740993', ExternalBillRate: '125.5', costKey: 'opaque+key' })
    expect(mocks.json.mock.calls[0][1].query.onlyData).toBeUndefined()
    mocks.json.mockResolvedValueOnce(record)
    await execute('get_project_cost', { ...auth, costKey: 'opaque+key' })
    expect(mocks.json.mock.calls[1][1].address.relativePath).toBe('projectCosts/opaque%2Bkey')
    mocks.json.mockResolvedValueOnce(record)
    await execute('update_project_cost', { ...auth, costKey: 'opaque+key', externalBillRate: 125.5, billableFlag: true })
    expect(JSON.parse(sentBody())).toEqual({ ExternalBillRate: 125.5 })
  })

  it.each([
    ['adjust_project_cost', { costKey: 'opaque+key', adjustmentTypeCode: 'TENANT_CODE', justification: 'Approved' }, 'projectCosts/opaque%2Bkey/action/adjustProjectCosts', { AdjustmentTypeCode: 'TENANT_CODE', Justification: 'Approved' }],
    ['adjust_project_budget', { planVersionId: '909', adjustmentPercentage: 5, adjustmentType: 'TENANT_TYPE', createNewWorkingVersion: 'Y' }, 'projectBudgets/909/action/adjust', { adjustmentPercentage: 5, adjustmentType: 'TENANT_TYPE', createNewWorkingVersion: 'Y' }],
    ['refresh_project_budget_rates', { planVersionId: '909', retainRateOverride: 'Y' }, 'projectBudgets/909/action/refreshRates', { retainRateOverride: 'Y' }],
  ] as Array<[OracleFusionProjectManagementOperation, Record<string, unknown>, string, Record<string, unknown>]>)('%s preserves the documented action result', async (operation, params, path, body) => {
    mocks.json.mockResolvedValue({ result: 'Completed', ignored: 'canary' })
    expect(await execute(operation, { ...auth, ...params })).toEqual({ success: true, output: { result: 'Completed' } })
    expect(mocks.json.mock.calls[0][1]).toMatchObject({ address: { family: 'fscm', relativePath: path }, method: 'POST', mediaType: 'application/vnd.oracle.adf.action+json' })
    expect(JSON.parse(sentBody())).toEqual(body)
  })

  it.each([
    ['submit', 'submitProjectContractInvoice', {}],
    ['approve', 'approveProjectContractInvoice', {}],
    ['reject', 'rejectProjectContractInvoice', {}],
    ['release', 'releaseProjectContractInvoice', { invoiceDate: '2026-09-04', receivablesNumber: 'INV-1' }],
    ['return_to_draft', 'returnToDraftProjectContractInvoice', {}],
    ['unrelease', 'unreleaseProjectContractInvoice', { unreleaseComments: 'Correct the draft' }],
    ['cancel', 'cancelProjectContractInvoice', {}],
  ])('dispatches the fixed %s invoice action without chaining other transitions', async (action, endpoint, params) => {
    mocks.json.mockResolvedValue({ result: 'Action completed' })
    await execute('transition_project_contract_invoice', { ...auth, invoiceId: '110', action, ...params as object })
    expect(mocks.json).toHaveBeenCalledTimes(1)
    expect(mocks.json.mock.calls[0][1].address.relativePath).toBe(`projectContractInvoices/110/action/${endpoint}`)
    expect(JSON.parse(sentBody())).toEqual(params)
  })

  it.each([
    ['delete_task', { projectId: '101', taskId: '202' }, 'projectPlans/101/child/Tasks/202', '202'],
    ['delete_deliverable', { deliverableId: '404' }, 'deliverables/404', '404'],
    ['delete_deliverable_task_association', { deliverableId: '404', associationId: '505' }, 'deliverables/404/child/ProjectTaskAssociation/505', '505'],
    ['delete_project_team_member', { projectId: '101', teamMemberId: '606' }, 'projects/101/child/ProjectTeamMembers/606', '606'],
    ['delete_task_labor_resource_assignment', { projectId: '101', assignmentId: '707' }, 'projectPlans/101/child/TaskLaborResourceAssignments/707', '707'],
    ['delete_project_budget', { planVersionId: '909' }, 'projectBudgets/909', '909'],
    ['delete_draft_project_contract_invoice', { invoiceId: '110' }, 'projectContractInvoices/110', '110'],
  ] as Array<[OracleFusionProjectManagementOperation, Record<string, unknown>, string, string]>)('%s supports empty successful responses', async (operation, params, path, id) => {
    expect(await execute(operation, { ...auth, ...params })).toEqual({ success: true, output: { deleted: true, id } })
    expect(mocks.empty.mock.calls[0][1]).toEqual({ address: { family: 'fscm', relativePath: path }, method: 'DELETE' })
    expect(mocks.json).not.toHaveBeenCalled()
  })

  it.each([
    ['get_project', { projectId: 9007199254740992 }],
    ['get_task', { projectId: '101', taskId: '../202' }],
    ['get_project_cost', { costKey: 'opaque/key' }],
    ['list_projects', { limit: 1001 }],
    ['update_task', { projectId: '101', taskId: '202' }],
    ['update_task', { projectId: '101', taskId: '202', physicalPercentComplete: 101 }],
    ['update_deliverable', { deliverableId: '404', needByDate: '2026-02-30' }],
    ['update_task_labor_resource_assignment', { projectId: '101', assignmentId: '707', resourceAllocation: 50 }],
    ['create_task_labor_resource_assignment', { projectId: '101', taskId: '202', resourceEmail: 'a@example.test', laborResourceId: '808' }],
    ['transition_project_contract_invoice', { invoiceId: '110', action: 'arbitraryAction' }],
    ['transition_project_contract_invoice', { invoiceId: '110', action: 'approve', unreleaseComments: 'Wrong action' }],
  ] as Array<[OracleFusionProjectManagementOperation, Record<string, unknown>]>)('rejects invalid input to %s before any provider call', async (operation, params) => {
    await expect(execute(operation, { ...auth, ...params })).rejects.toThrow()
    expect(mocks.json).not.toHaveBeenCalled()
    expect(mocks.empty).not.toHaveBeenCalled()
  })

  it('does not invent empty resource or action shapes, and marks uncertain mutations non-retryable', async () => {
    mocks.json.mockResolvedValueOnce({ unrelated: 'canary' })
    expect((await execute('get_project', { ...auth, projectId: '101' })).success).toBe(false)
    mocks.json.mockResolvedValueOnce(null)
    const action = await execute('transition_project_contract_invoice', { ...auth, invoiceId: '110', action: 'approve' })
    expect(action).toMatchObject({ success: false, output: {}, retryable: false })
    expect(action.error).toContain('may have completed')
  })

  it('preserves safe foundation errors and cancellation without leaking unexpected errors', async () => {
    mocks.json.mockRejectedValueOnce(new OracleFusionProviderError('Oracle Fusion access denied', 403))
    expect((await execute('get_project', { ...auth, projectId: '101' })).error).toBe('Oracle Fusion access denied')
    mocks.json.mockRejectedValueOnce(new Error('provider-secret-canary'))
    expect(JSON.stringify(await execute('get_project', { ...auth, projectId: '101' }))).not.toContain('provider-secret-canary')
    const controller = new AbortController()
    mocks.json.mockImplementationOnce(() => { controller.abort(); throw controller.signal.reason })
    await expect(execute('get_project', { ...auth, projectId: '101' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
