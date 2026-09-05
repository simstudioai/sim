/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion-project-management/operations', () => ({
  executeOracleFusionProjectManagementOperation: mocks.execute,
  OracleFusionProjectManagementInputError: class extends Error {},
}))

import { OracleFusionProjectManagementInputError } from '@/lib/internal/oracle-fusion-project-management/operations'
import { executeOracleFusionProjectManagementTool } from '@/lib/internal/oracle-fusion-project-management/execute-tool'
import { getInternalToolOperationHandler } from '@/lib/internal/tool-operations/registry.server'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

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

function request(toolId: string, input: unknown = {}): InternalToolOperationCall {
  return { toolId, input, headers: new Headers(), context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', userId: 'user-1' }, requestId: 'request-1' }
}

describe('Oracle Project Management internal dispatch', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue({ success: true, output: { result: 'ok' } }) })

  it.each(OPERATIONS)('registers and dispatches %s without changing semantic inputs', async (operation) => {
    const toolId = `oracle_fusion_project_management_${operation}`
    const handler = await getInternalToolOperationHandler(toolId)
    expect(handler).toBe(executeOracleFusionProjectManagementTool)
    const input = { projectId: '999999999999999999', oauthCredential: 'credential-1' }
    const controller = new AbortController()
    const response = await handler!({ ...request(toolId, input), signal: controller.signal })
    expect(mocks.execute).toHaveBeenCalledWith(operation, input, controller.signal)
    expect(await response.json()).toEqual({ success: true, output: { result: 'ok' } })
  })

  it('rejects unsupported routes without falling back to an arbitrary Oracle request', async () => {
    expect(await getInternalToolOperationHandler('oracle_fusion_project_management_arbitrary')).toBeNull()
    const response = await executeOracleFusionProjectManagementTool(request('oracle_fusion_project_management_arbitrary'))
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([null, [], 'not an object', { projectId: '../unsafe' }])('preserves operation validation failures as bad input', async (input) => {
    mocks.execute.mockRejectedValue(new OracleFusionProjectManagementInputError('projectId is invalid'))
    const response = await executeOracleFusionProjectManagementTool(request('oracle_fusion_project_management_get_project', input))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ success: false, error: 'projectId is invalid' })
  })

  it('propagates cancellation and sanitizes unexpected dispatch errors', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(executeOracleFusionProjectManagementTool({ ...request('oracle_fusion_project_management_list_projects'), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.execute).not.toHaveBeenCalled()
    mocks.execute.mockRejectedValue(new Error('secret-canary'))
    const response = await executeOracleFusionProjectManagementTool(request('oracle_fusion_project_management_list_projects'))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secret-canary')
  })
})

