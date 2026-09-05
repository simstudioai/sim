import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionRefreshProjectBudgetRatesParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-action-refreshrates-post.html
export const oracleFusionProjectManagementRefreshProjectBudgetRatesTool: InternalToolConfig<
  OracleFusionRefreshProjectBudgetRatesParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_refresh_project_budget_rates',
  name: 'Oracle Fusion Project Management Refresh Project Budget Rates',
  description: 'Refresh project budget rates in Oracle Fusion Cloud Project Management.',
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
    retainRateOverride: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Retain rate override (null is accepted by the documented API)',
    },
    refreshOnlyConversionRates: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Refresh only conversion rates (null is accepted by the documented API)',
    },
    refreshRatesPeriodForward: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Refresh rates period forward (null is accepted by the documented API)',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    result: {
      type: 'string',
      description: 'Documented Oracle action result; not a refreshed resource',
    },
  },
}
