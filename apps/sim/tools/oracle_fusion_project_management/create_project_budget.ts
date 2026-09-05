import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionCreateProjectBudgetParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionBudgetOutput,
  oracleFusionBudgetResourceItemSchema,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-post.html
export const oracleFusionProjectManagementCreateProjectBudgetTool: InternalToolConfig<
  OracleFusionCreateProjectBudgetParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_create_project_budget',
  name: 'Oracle Fusion Project Management Create Project Budget',
  description: "Create or copy a project budget version, optionally with resource/amount lines. Financial plan types, resource breakdown structures, currencies, and deferred creation are tenant-configured.",
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "project ID as an exact decimal ID string",
    },
    projectName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "project Name",
    },
    projectNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "project Number",
    },
    planVersionName: {
      type: 'string',
      required: true,
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
    budgetCreationMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "budget Creation Method (null is accepted by the documented API)",
    },
    budgetGenerationSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "budget Generation Source (null is accepted by the documented API)",
    },
    planningAmounts: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "planning Amounts (null is accepted by the documented API)",
    },
    sourcePlanType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "source Plan Type (null is accepted by the documented API)",
    },
    sourcePlanVersionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "source Plan Version ID as an exact decimal ID string (null is accepted by the documented API)",
    },
    sourcePlanVersionNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "source Plan Version Number (null is accepted by the documented API)",
    },
    sourcePlanVersionStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "source Plan Version Status (null is accepted by the documented API)",
    },
    copyAdjustmentPercentage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "copy Adjustment Percentage (null is accepted by the documented API)",
    },
    deferFinancialPlanCreation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "defer Financial Plan Creation (null is accepted by the documented API)",
    },
    planningResources: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: "Budget lines with RbsElementId and TaskId as strings, and optional PlanningAmounts; no HCM person IDs",
      items: oracleFusionBudgetResourceItemSchema,
      maxItems: 100,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    budget: { type: 'json', description: 'Documented budget fields', properties: oracleFusionBudgetOutput },
  },
}
