import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetProjectBudgetParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionBudgetOutput,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-get.html
export const oracleFusionProjectManagementGetProjectBudgetTool: InternalToolConfig<
  OracleFusionGetProjectBudgetParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_project_budget',
  name: 'Oracle Fusion Project Management Get Project Budget',
  description: 'Get project budget in Oracle Fusion Cloud Project Management.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    planVersionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Plan version ID as a decimal string',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    budget: {
      type: 'json',
      description: 'Documented budget fields',
      properties: oracleFusionBudgetOutput,
    },
  },
}
