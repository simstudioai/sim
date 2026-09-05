import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetTaskParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionTaskOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-projectid-child-tasks-taskid-get.html
export const oracleFusionProjectManagementGetTaskTool: InternalToolConfig<
  OracleFusionGetTaskParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_task',
  name: 'Oracle Fusion Project Management Get Task',
  description: "Get task in Oracle Fusion Cloud Project Management.",
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
      description: "task ID as a decimal string",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    task: { type: 'json', description: 'Documented task fields', properties: oracleFusionTaskOutput },
  },
}
