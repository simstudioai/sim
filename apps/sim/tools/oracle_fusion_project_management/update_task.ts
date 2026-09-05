import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionProjectManagementResponse,
  OracleFusionUpdateTaskParams,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionTaskOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasks-taskid-patch.html
export const oracleFusionProjectManagementUpdateTaskTool: InternalToolConfig<
  OracleFusionUpdateTaskParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_update_task',
  name: 'Oracle Fusion Project Management Update Task',
  description: 'Update task in Oracle Fusion Cloud Project Management.',
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
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task ID as a decimal string',
    },
    taskName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task name',
    },
    taskNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task number',
    },
    taskLevel: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task level',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description (null is accepted by the documented API)',
    },
    parentTaskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Parent task ID as an exact decimal ID string (null is accepted by the documented API)',
    },
    milestoneFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Milestone flag (null is accepted by the documented API)',
    },
    plannedStartDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned start date time (null is accepted by the documented API)',
    },
    plannedFinishDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned finish date time (null is accepted by the documented API)',
    },
    plannedEffort: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned effort (null is accepted by the documented API)',
    },
    plannedDuration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned duration (null is accepted by the documented API)',
    },
    taskStatusCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task status code (null is accepted by the documented API)',
    },
    statusChangeComments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status change comments (null is accepted by the documented API)',
    },
    physicalPercentComplete: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Physical percent complete (null is accepted by the documented API)',
    },
    percentComplete: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Percent complete (null is accepted by the documented API)',
    },
    actualStartDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actual start date time (null is accepted by the documented API)',
    },
    actualFinishDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actual finish date time (null is accepted by the documented API)',
    },
    actualHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actual hours (null is accepted by the documented API)',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    task: {
      type: 'json',
      description: 'Documented task fields',
      properties: oracleFusionTaskOutput,
    },
  },
}
