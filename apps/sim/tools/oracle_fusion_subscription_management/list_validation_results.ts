import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListValidationResultsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  PAGINATION_OUTPUTS,
  VALIDATION_RESULT_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListValidationResultsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListValidationResultsParams>({
    id: 'oracle_fusion_subscription_management_list_validation_results',
    operation: 'list_validation_results',
    name: 'Oracle Fusion Subscription Management List validation results',
    description:
      'List validation results in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: VALIDATION_RESULT_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
