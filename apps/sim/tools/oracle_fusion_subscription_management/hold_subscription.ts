import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionHoldSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionHoldSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionHoldSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_hold_subscription',
    operation: 'hold_subscription',
    name: 'Oracle Fusion Subscription Management Hold subscription',
    description:
      'Hold subscription using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
