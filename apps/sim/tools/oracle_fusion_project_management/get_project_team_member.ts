import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetProjectTeamMemberParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionTeamMemberOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectteammembers-teammemberid-get.html
export const oracleFusionProjectManagementGetProjectTeamMemberTool: InternalToolConfig<
  OracleFusionGetProjectTeamMemberParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_project_team_member',
  name: 'Oracle Fusion Project Management Get Project Team Member',
  description: "Get project team member in Oracle Fusion Cloud Project Management.",
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
    teamMemberId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "team Member ID as a decimal string",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    teamMember: { type: 'json', description: 'Documented team Member fields', properties: oracleFusionTeamMemberOutput },
  },
}
