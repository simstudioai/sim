import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionAdjustProjectCostParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcosts-projectcostsuniqid-action-adjustprojectcosts-post.html
export const oracleFusionProjectManagementAdjustProjectCostTool: InternalToolConfig<
  OracleFusionAdjustProjectCostParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_adjust_project_cost',
  name: 'Oracle Fusion Project Management Adjust Project Cost',
  description:
    'Perform a project-cost adjustment using a configured PJC_ADJUSTMENT_TYPE code. Oracle validates which fields and transaction states apply to that adjustment.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    costKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Opaque project-cost key returned by list or get; not the numeric costId',
    },
    adjustmentTypeCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Adjustment type code',
    },
    justification: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Justification (null is accepted by the documented API)',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment (null is accepted by the documented API)',
    },
    quantity: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Quantity (null is accepted by the documented API)',
    },
    billableFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billable flag (null is accepted by the documented API)',
    },
    capitalizableFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Capitalizable flag (null is accepted by the documented API)',
    },
    holdInvoiceFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hold invoice flag (null is accepted by the documented API)',
    },
    holdRevenueFlag: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hold revenue flag (null is accepted by the documented API)',
    },
    targetProjectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Target project ID as an exact decimal ID string (null is accepted by the documented API)',
    },
    targetTaskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Target task ID as an exact decimal ID string (null is accepted by the documented API)',
    },
    rawCostInTransactionCurrency: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Raw cost in transaction currency (null is accepted by the documented API)',
    },
    transactionCurrencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction currency code (null is accepted by the documented API)',
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
