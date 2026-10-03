import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCancelProductParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCancelProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCancelProductParams>({
    id: 'oracle_fusion_subscription_management_cancel_product',
    operation: 'cancel_product',
    name: 'Oracle Fusion Subscription Management Cancel product',
    description:
      'Cancel product using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
