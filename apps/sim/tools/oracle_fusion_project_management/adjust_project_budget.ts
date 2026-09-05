import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionAdjustProjectBudgetParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-action-adjust-post.html
export const oracleFusionProjectManagementAdjustProjectBudgetTool: InternalToolConfig<
  OracleFusionAdjustProjectBudgetParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_adjust_project_budget',
  name: 'Oracle Fusion Project Management Adjust Project Budget',
  description: "Adjust project budget in Oracle Fusion Cloud Project Management.",
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    planVersionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "plan Version ID as a decimal string",
    },
    adjustmentPercentage: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: "adjustment Percentage (null is accepted by the documented API)",
    },
    fromPeriod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "from Period (null is accepted by the documented API)",
    },
    adjustmentType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "adjustment Type (null is accepted by the documented API)",
    },
    toPeriod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "to Period (null is accepted by the documented API)",
    },
    createNewWorkingVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "create New Working Version (null is accepted by the documented API)",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    result: { type: 'string', description: 'Documented Oracle action result; not a refreshed resource' },
  },
}
