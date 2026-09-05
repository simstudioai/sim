/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { OracleFusionProjectManagementBlock as block, OracleFusionProjectManagementBlockMeta as meta } from '@/blocks/blocks/oracle_fusion_project_management'
import { NetSuiteIcon } from '@/components/icons'
import { selectorManifest } from '@/lib/selectors/manifest'

const prefix = 'oracle_fusion_project_management_'
const OPERATIONS = [
  'list_projects',
  'get_project',
  'create_project',
  'update_project',
  'list_project_statuses',
  'list_project_status_history',
  'list_project_plans',
  'get_project_plan',
  'list_tasks',
  'get_task',
  'create_task',
  'update_task',
  'delete_task',
  'list_milestones',
  'create_milestone',
  'list_task_status_history',
  'list_deliverables',
  'get_deliverable',
  'create_deliverable',
  'update_deliverable',
  'delete_deliverable',
  'list_deliverable_task_associations',
  'get_deliverable_task_association',
  'create_deliverable_task_association',
  'update_deliverable_task_association',
  'delete_deliverable_task_association',
  'list_project_team_members',
  'get_project_team_member',
  'create_project_team_member',
  'update_project_team_member',
  'delete_project_team_member',
  'list_task_labor_resource_assignments',
  'get_task_labor_resource_assignment',
  'create_task_labor_resource_assignment',
  'update_task_labor_resource_assignment',
  'delete_task_labor_resource_assignment',
  'list_project_enterprise_resources',
  'list_project_costs',
  'get_project_cost',
  'update_project_cost',
  'adjust_project_cost',
  'list_project_budgets',
  'get_project_budget',
  'create_project_budget',
  'update_project_budget',
  'delete_project_budget',
  'adjust_project_budget',
  'refresh_project_budget_rates',
  'list_project_contract_invoices',
  'get_project_contract_invoice',
  'update_project_contract_invoice',
  'delete_draft_project_contract_invoice',
  'transition_project_contract_invoice',
] as const

function map(operation: string, params: Record<string, unknown> = {}) {
  return block.tools.config!.params!({ operation: prefix + operation, oauthCredential: 'credential-1', ...params })
}

describe('Oracle Project Management block', () => {
  it('has the complete 53-operation surface, a read-first default, and the established Oracle icon', () => {
    const operation = block.subBlocks.find((field) => field.id === 'operation')!
    const options = typeof operation.options === 'function' ? operation.options() : operation.options
    expect(options?.map((option) => option.id)).toEqual(OPERATIONS.map((name) => prefix + name))
    expect(operation.value?.({})).toBe(prefix + 'list_projects')
    expect(block.icon).toBe(NetSuiteIcon)
    expect(meta.templates).toHaveLength(7)
    expect(meta.skills).toHaveLength(3)
    expect(new Set(block.subBlocks.map((field) => field.id)).size).toBe(block.subBlocks.length)
  })

  it.each(OPERATIONS)('routes %s before resolving numeric or structured workflow references', (operation) => {
    const toolId = block.tools.config!.tool!({ operation: prefix + operation, projectId: '<project.ProjectId>', limit: '<agent.limit>', planningResources: '<agent.lines>' })
    expect(toolId).toBe(prefix + operation)
    expect(block.tools.access).toContain(toolId)
    expect(block.canvasPresentation?.sentences?.byOperation?.[prefix + operation]).toBeDefined()
  })

  it('rejects unsupported operations without attempting reference coercion', () => {
    expect(() => block.tools.config!.tool!({ operation: 'arbitrary', limit: '<agent.limit>' })).toThrow('Unsupported')
  })

  it.each([
    ['projectId', 'projects', ['credential']],
    ['taskId', 'tasks', ['credential', 'projectId']],
    ['organizationName', 'organizations', ['credential']],
    ['personEmail', 'resources', ['credential']],
    ['projectRole', 'roles', ['credential']],
    ['deliverableTypeId', 'deliverableTypes', ['credential']],
    ['assignmentId', 'laborAssignments', ['credential', 'projectId', 'taskId']],
  ] as const)('keeps %s basic/manual inputs canonical and dependency-bound', (field, selector, dependencies) => {
    const basic = block.subBlocks.find((input) => input.id === field + 'Selector')!
    const manual = block.subBlocks.find((input) => input.id === field + 'Manual')!
    expect(basic).toMatchObject({ type: 'project-selector', canonicalParamId: field, mode: 'basic', selectorKey: 'oracleFusionProjectManagement.' + selector, dependsOn: [...dependencies] })
    expect(manual).toMatchObject({ type: 'short-input', canonicalParamId: field, mode: 'advanced' })
    expect(basic.required).toEqual(manual.required)
    expect(basic.condition).toEqual(manual.condition)
    expect(block.inputs[field]).toBeDefined()
  })

  it('requires both project and task context for the task-assignment selector', () => {
    expect(selectorManifest['oracleFusionProjectManagement.laborAssignments'].context).toEqual({
      allowed: ['oauthCredential', 'projectId', 'taskId'],
      readiness: { all: ['oauthCredential', 'projectId', 'taskId'] },
    })
  })

  it('maps resolved canonical values without numeric ID coercion and clears stale inputs', () => {
    const result = map('update_task', { projectId: '999999999999999999', taskId: '9007199254740993', physicalPercentComplete: '50', milestoneFlag: 'false', projectName: 'stale', invoiceId: 'stale' })
    expect(result).toMatchObject({ oauthCredential: 'credential-1', projectId: '999999999999999999', taskId: '9007199254740993', physicalPercentComplete: 50, milestoneFlag: false, projectName: undefined, invoiceId: undefined })
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('invoiceId')
    expect(map('update_project', { projectId: '101', projectDescription: null }).projectDescription).toBeNull()
  })

  it('keeps task-assignment context out of updates and parses documented budget arrays after resolution', () => {
    expect(map('update_task_labor_resource_assignment', { projectId: '101', taskId: '202', assignmentId: '707', resourceEmail: 'a@example.test' })).toMatchObject({ taskId: undefined, assignmentId: '707', resourceEmail: 'a@example.test' })
    const resources = [{ RbsElementId: '999999999999999999', TaskId: '202', PlanningAmounts: [{ Currency: 'USD', Quantity: 2 }] }]
    expect(map('create_project_budget', { planningResources: JSON.stringify(resources) }).planningResources).toEqual(resources)
  })

  it('retains only action-specific invoice inputs when operations or transitions change', () => {
    const result = map('transition_project_contract_invoice', { invoiceId: '110', action: 'approve', invoiceDate: '2026-09-04', unreleaseComments: 'stale', receivablesNumber: 'stale' })
    expect(result).toMatchObject({ invoiceId: '110', action: 'approve', invoiceDate: undefined, unreleaseComments: undefined, receivablesNumber: undefined })
    expect(map('transition_project_contract_invoice', { invoiceId: '110', action: 'release', invoiceDate: '2026-09-04' }).invoiceDate).toBe('2026-09-04')
  })
})

