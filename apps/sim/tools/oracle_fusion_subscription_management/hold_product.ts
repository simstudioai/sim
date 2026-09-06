import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionHoldProductParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionHoldProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionHoldProductParams>({
    id: 'oracle_fusion_subscription_management_hold_product',
    operation: 'hold_product',
    name: 'Oracle Fusion Subscription Management Hold product',
    description:
      'Hold product using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
