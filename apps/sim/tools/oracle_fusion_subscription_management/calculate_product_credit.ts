import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCalculateProductCreditParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCalculateProductCreditTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCalculateProductCreditParams>({
    id: 'oracle_fusion_subscription_management_calculate_product_credit',
    operation: 'calculate_product_credit',
    name: 'Oracle Fusion Subscription Management Calculate product credit',
    description: 'Calculate product credit using the documented Oracle calculation action.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
