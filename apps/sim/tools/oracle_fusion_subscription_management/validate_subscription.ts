import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionValidateSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionValidateSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionValidateSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_validate_subscription',
    operation: 'validate_subscription',
    name: 'Oracle Fusion Subscription Management Validate subscription',
    description:
      'Validate subscription using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
