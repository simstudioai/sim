import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetValidationResultParams } from '@/tools/oracle_fusion_subscription_management/types'
import { VALIDATION_RESULT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetValidationResultTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetValidationResultParams>({
    id: 'oracle_fusion_subscription_management_get_validation_result',
    operation: 'get_validation_result',
    name: 'Oracle Fusion Subscription Management Get validation result',
    description: 'Get validation result in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: VALIDATION_RESULT_OUTPUT_PROPERTIES,
      },
    },
  })
