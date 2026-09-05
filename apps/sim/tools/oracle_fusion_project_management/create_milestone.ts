import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionCreateMilestoneParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionTaskOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasks-post.html
export const oracleFusionProjectManagementCreateMilestoneTool: InternalToolConfig<
  OracleFusionCreateMilestoneParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_create_milestone',
  name: 'Oracle Fusion Project Management Create Milestone',
  description: "Create a task with MilestoneFlag=true using projectPlans management access. Update or delete the milestone with the task tools.",
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
    taskName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "task Name",
    },
    taskNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "task Number",
    },
    taskLevel: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: "task Level",
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "description (null is accepted by the documented API)",
    },
    parentTaskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "parent Task ID as an exact decimal ID string (null is accepted by the documented API)",
    },
    plannedStartDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "planned Start Date Time (null is accepted by the documented API)",
    },
    plannedFinishDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "planned Finish Date Time (null is accepted by the documented API)",
    },
    plannedEffort: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "planned Effort (null is accepted by the documented API)",
    },
    plannedDuration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "planned Duration (null is accepted by the documented API)",
    },
    taskStatusCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "task Status Code (null is accepted by the documented API)",
    },
    statusChangeComments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "status Change Comments (null is accepted by the documented API)",
    },
    physicalPercentComplete: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "physical Percent Complete (null is accepted by the documented API)",
    },
    percentComplete: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "percent Complete (null is accepted by the documented API)",
    },
    actualStartDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "actual Start Date Time (null is accepted by the documented API)",
    },
    actualFinishDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "actual Finish Date Time (null is accepted by the documented API)",
    },
    actualHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "actual Hours (null is accepted by the documented API)",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    task: { type: 'json', description: 'Documented task fields', properties: oracleFusionTaskOutput },
  },
}
