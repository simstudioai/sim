import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionDeleteTaskLaborResourceAssignmentParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-tasklaborresourceassignmentid-delete.html
export const oracleFusionProjectManagementDeleteTaskLaborResourceAssignmentTool: InternalToolConfig<
  OracleFusionDeleteTaskLaborResourceAssignmentParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_delete_task_labor_resource_assignment',
  name: 'Oracle Fusion Project Management Delete Task Labor Resource Assignment',
  description: "Delete task labor resource assignment in Oracle Fusion Cloud Project Management.",
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
    assignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "assignment ID as a decimal string",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    deleted: { type: 'boolean', description: 'True after Oracle accepts the deletion with an empty success response' },
    id: { type: 'string', description: 'Identifier supplied to this delete operation' },
  },
}
