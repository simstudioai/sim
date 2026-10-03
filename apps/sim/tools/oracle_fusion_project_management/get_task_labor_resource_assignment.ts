import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetTaskLaborResourceAssignmentParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionLaborAssignmentOutput,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-tasklaborresourceassignmentid-get.html
export const oracleFusionProjectManagementGetTaskLaborResourceAssignmentTool: InternalToolConfig<
  OracleFusionGetTaskLaborResourceAssignmentParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_task_labor_resource_assignment',
  name: 'Oracle Fusion Project Management Get Task Labor Resource Assignment',
  description: 'Get task labor resource assignment in Oracle Fusion Cloud Project Management.',
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
