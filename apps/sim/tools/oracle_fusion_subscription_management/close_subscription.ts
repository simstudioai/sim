import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCloseSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCloseSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCloseSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_close_subscription',
    operation: 'close_subscription',
    name: 'Oracle Fusion Subscription Management Close subscription',
    description:
      'Close subscription using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
