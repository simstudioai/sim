import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionSuspendProductParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionSuspendProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionSuspendProductParams>({
    id: 'oracle_fusion_subscription_management_suspend_product',
    operation: 'suspend_product',
    name: 'Oracle Fusion Subscription Management Suspend product',
    description:
      'Suspend product using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
