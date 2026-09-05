import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCloseProductParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCloseProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCloseProductParams>({
    id: 'oracle_fusion_subscription_management_close_product',
    operation: 'close_product',
    name: 'Oracle Fusion Subscription Management Close product',
    description:
      'Close product using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
