import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionUpdateProjectBudgetParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionBudgetOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-patch.html
export const oracleFusionProjectManagementUpdateProjectBudgetTool: InternalToolConfig<
  OracleFusionUpdateProjectBudgetParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_update_project_budget',
  name: 'Oracle Fusion Project Management Update Project Budget',
  description: "Update project budget in Oracle Fusion Cloud Project Management.",
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
    planVersionName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "plan Version Name",
    },
    planVersionDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "plan Version Description (null is accepted by the documented API)",
    },
    financialPlanType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "financial Plan Type (null is accepted by the documented API)",
    },
    planVersionStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "plan Version Status (null is accepted by the documented API)",
    },
    lockedFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: "locked Flag (null is accepted by the documented API)",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    budget: { type: 'json', description: 'Documented budget fields', properties: oracleFusionBudgetOutput },
  },
}
