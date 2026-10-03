import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCancelSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCancelSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCancelSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_cancel_subscription',
    operation: 'cancel_subscription',
    name: 'Oracle Fusion Subscription Management Cancel subscription',
    description:
      'Cancel subscription using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
