import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionCreateProjectTeamMemberParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionTeamMemberOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectteammembers-post.html
export const oracleFusionProjectManagementCreateProjectTeamMemberTool: InternalToolConfig<
  OracleFusionCreateProjectTeamMemberParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_create_project_team_member',
  name: 'Oracle Fusion Project Management Create Project Team Member',
  description: 'Create project team member in Oracle Fusion Cloud Project Management.',
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
    personEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Person email',
    },
    projectRole: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project role',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date (null is accepted by the documented API)',
    },
    finishDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Finish date (null is accepted by the documented API)',
    },
    assignmentTypeCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assignment type code (null is accepted by the documented API)',
    },
    resourceAllocationPercentage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resource allocation percentage (null is accepted by the documented API)',
    },
    resourceAssignmentEffortInHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resource assignment effort in hours (null is accepted by the documented API)',
    },
    billablePercent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billable percent (null is accepted by the documented API)',
    },
    trackTimeFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Track time flag (null is accepted by the documented API)',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    teamMember: {
      type: 'json',
      description: 'Documented team Member fields',
      properties: oracleFusionTeamMemberOutput,
    },
  },
}
