import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionCreateTaskLaborResourceAssignmentParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionLaborAssignmentOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-post.html
export const oracleFusionProjectManagementCreateTaskLaborResourceAssignmentTool: InternalToolConfig<
  OracleFusionCreateTaskLaborResourceAssignmentParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_create_task_labor_resource_assignment',
  name: 'Oracle Fusion Project Management Create Task Labor Resource Assignment',
  description: "Assign a labor resource to a task. Supply exactly one of resourceEmail and laborResourceId; management access is required.",
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "project ID as a decimal string",
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "task ID as an exact decimal ID string",
    },
    resourceEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "resource Email (null is accepted by the documented API)",
    },
    laborResourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "labor Resource ID as an exact decimal ID string (null is accepted by the documented API)",
    },
    plannedEffortinHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "planned Effort in hours (null is accepted by the documented API)",
    },
    actualEffortinHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "actual Effort in hours (null is accepted by the documented API)",
    },
    remainingEffortinHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "remaining Effort in hours (null is accepted by the documented API)",
    },
    percentComplete: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "percent Complete (null is accepted by the documented API)",
    },
    primaryResourceFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: "primary Resource Flag (null is accepted by the documented API)",
    },
    resourceAllocation: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "resource Allocation (null is accepted by the documented API)",
    },
    effectiveBillRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "effective Bill Rate (null is accepted by the documented API)",
    },
    effectiveCostRate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "effective Cost Rate (null is accepted by the documented API)",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    laborAssignment: { type: 'json', description: 'Documented labor Assignment fields', properties: oracleFusionLaborAssignmentOutput },
  },
}
