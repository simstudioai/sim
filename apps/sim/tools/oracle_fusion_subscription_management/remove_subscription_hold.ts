import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionRemoveSubscriptionHoldParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionRemoveSubscriptionHoldTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionRemoveSubscriptionHoldParams>({
    id: 'oracle_fusion_subscription_management_remove_subscription_hold',
    operation: 'remove_subscription_hold',
    name: 'Oracle Fusion Subscription Management Remove subscription hold',
    description:
      'Remove subscription hold using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
