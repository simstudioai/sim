import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionRemoveProductHoldParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionRemoveProductHoldTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionRemoveProductHoldParams>({
    id: 'oracle_fusion_subscription_management_remove_product_hold',
    operation: 'remove_product_hold',
    name: 'Oracle Fusion Subscription Management Remove product hold',
    description:
      'Remove product hold using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
