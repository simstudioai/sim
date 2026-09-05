import {
  executeOracleFusionProjectManagementOperation,
  OracleFusionProjectManagementInputError,
} from '@/lib/internal/oracle-fusion-project-management/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOracleFusionProjectManagementTool: InternalToolOperationHandler = async (
  request
) => {
  request.signal?.throwIfAborted()
  try {
    switch (request.toolId) {
      case 'oracle_fusion_project_management_list_projects':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_projects',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_project':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_project',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_create_project':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'create_project',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_update_project':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'update_project',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_project_statuses':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_project_statuses',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_project_status_history':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_project_status_history',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_project_plans':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_project_plans',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_project_plan':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_project_plan',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_tasks':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_tasks',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_task':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_task',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_create_task':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'create_task',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_update_task':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'update_task',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_delete_task':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'delete_task',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_milestones':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_milestones',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_create_milestone':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'create_milestone',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_task_status_history':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_task_status_history',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_deliverables':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_deliverables',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_deliverable':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_deliverable',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_create_deliverable':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'create_deliverable',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_update_deliverable':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'update_deliverable',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_delete_deliverable':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'delete_deliverable',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_deliverable_task_associations':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_deliverable_task_associations',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_deliverable_task_association':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_deliverable_task_association',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_create_deliverable_task_association':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'create_deliverable_task_association',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_update_deliverable_task_association':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'update_deliverable_task_association',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_delete_deliverable_task_association':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'delete_deliverable_task_association',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_project_team_members':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_project_team_members',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_project_team_member':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_project_team_member',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_create_project_team_member':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'create_project_team_member',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_update_project_team_member':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'update_project_team_member',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_delete_project_team_member':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'delete_project_team_member',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_task_labor_resource_assignments':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_task_labor_resource_assignments',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_task_labor_resource_assignment':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_task_labor_resource_assignment',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_create_task_labor_resource_assignment':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'create_task_labor_resource_assignment',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_update_task_labor_resource_assignment':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'update_task_labor_resource_assignment',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_delete_task_labor_resource_assignment':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'delete_task_labor_resource_assignment',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_project_enterprise_resources':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_project_enterprise_resources',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_project_costs':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_project_costs',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_project_cost':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_project_cost',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_update_project_cost':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'update_project_cost',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_adjust_project_cost':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'adjust_project_cost',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_project_budgets':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_project_budgets',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_project_budget':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_project_budget',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_create_project_budget':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'create_project_budget',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_update_project_budget':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'update_project_budget',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_delete_project_budget':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'delete_project_budget',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_adjust_project_budget':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'adjust_project_budget',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_refresh_project_budget_rates':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'refresh_project_budget_rates',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_list_project_contract_invoices':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'list_project_contract_invoices',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_get_project_contract_invoice':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'get_project_contract_invoice',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_update_project_contract_invoice':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'update_project_contract_invoice',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_delete_draft_project_contract_invoice':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'delete_draft_project_contract_invoice',
            request.input,
            request.signal
          )
        )
      case 'oracle_fusion_project_management_transition_project_contract_invoice':
        return Response.json(
          await executeOracleFusionProjectManagementOperation(
            'transition_project_contract_invoice',
            request.input,
            request.signal
          )
        )
      default:
        return Response.json({ success: false, error: 'Unsupported Oracle Project Management tool' }, { status: 400 })
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof OracleFusionProjectManagementInputError) {
      return Response.json({ success: false, error: error.message }, { status: 400 })
    }
    return Response.json({ success: false, error: 'Oracle Project Management operation failed' }, { status: 500 })
  }
}
