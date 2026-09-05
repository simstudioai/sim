import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetProjectPlanParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionPlanOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-projectid-get.html
export const oracleFusionProjectManagementGetProjectPlanTool: InternalToolConfig<
  OracleFusionGetProjectPlanParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_project_plan',
  name: 'Oracle Fusion Project Management Get Project Plan',
  description: "Read a visible project plan using projectPlanDetails; does not require selecting the management-only projectPlans resource.",
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
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    plan: { type: 'json', description: 'Documented plan fields', properties: oracleFusionPlanOutput },
  },
}
