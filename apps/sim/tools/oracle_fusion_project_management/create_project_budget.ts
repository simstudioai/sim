import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionCreateProjectBudgetParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionBudgetOutput,
  oracleFusionBudgetResourceItemSchema,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-post.html
export const oracleFusionProjectManagementCreateProjectBudgetTool: InternalToolConfig<
  OracleFusionCreateProjectBudgetParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_create_project_budget',
  name: 'Oracle Fusion Project Management Create Project Budget',
  description:
    'Create or copy a project budget version synchronously, optionally with resource/amount lines. Financial plan types, resource breakdown structures, and currencies are tenant-configured.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID as an exact decimal ID string',
    },
    projectName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project name',
    },
    projectNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project number',
    },
    planVersionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Plan version name',
    },
    planVersionDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plan version description (null is accepted by the documented API)',
    },
    financialPlanType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Financial plan type (null is accepted by the documented API)',
    },
    planVersionStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plan version status (null is accepted by the documented API)',
    },
    budgetCreationMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Budget creation method (null is accepted by the documented API)',
    },
    budgetGenerationSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Budget generation source (null is accepted by the documented API)',
    },
    planningAmounts: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planning amounts (null is accepted by the documented API)',
    },
    sourcePlanType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source plan type (null is accepted by the documented API)',
    },
    sourcePlanVersionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Source plan version ID as an exact decimal ID string (null is accepted by the documented API)',
    },
    sourcePlanVersionNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source plan version number (null is accepted by the documented API)',
    },
    sourcePlanVersionStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source plan version status (null is accepted by the documented API)',
    },
    copyAdjustmentPercentage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Copy adjustment percentage (null is accepted by the documented API)',
    },
    deferFinancialPlanCreation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only N is supported: create the budget synchronously and return its version; deferred creation is not supported',
    },
    planningResources: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Budget lines with rbsElementId and taskId as strings, and optional planningAmounts; no HCM person IDs',
      items: oracleFusionBudgetResourceItemSchema,
      maxItems: 100,
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
