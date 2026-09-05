import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionProjectManagementResponse,
  OracleFusionUpdateTaskLaborResourceAssignmentParams,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionLaborAssignmentOutput,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-tasklaborresourceassignmentid-patch.html
export const oracleFusionProjectManagementUpdateTaskLaborResourceAssignmentTool: InternalToolConfig<
  OracleFusionUpdateTaskLaborResourceAssignmentParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_update_task_labor_resource_assignment',
  name: 'Oracle Fusion Project Management Update Task Labor Resource Assignment',
  description:
    'Update an assignment using projectPlans management access. Supply exactly one of resourceEmail and laborResourceId, as required by Oracle for PATCH.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID as a decimal string',
    },
    assignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Assignment ID as a decimal string',
    },
    resourceEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resource email',
    },
    laborResourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Labor resource ID as an exact decimal ID string',
    },
    plannedEffortinHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned effort in hours (null is accepted by the documented API)',
    },
    actualEffortinHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actual effort in hours (null is accepted by the documented API)',
    },
    remainingEffortinHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Remaining effort in hours (null is accepted by the documented API)',
    },
    percentComplete: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Percent complete (null is accepted by the documented API)',
    },
    primaryResourceFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary resource flag (null is accepted by the documented API)',
    },
    resourceAllocation: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resource allocation (null is accepted by the documented API)',
    },
    effectiveBillRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective bill rate (null is accepted by the documented API)',
    },
    effectiveCostRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective cost rate (null is accepted by the documented API)',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    laborAssignment: {
      type: 'json',
      description: 'Documented labor Assignment fields',
      properties: oracleFusionLaborAssignmentOutput,
    },
  },
}
