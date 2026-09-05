import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCalculateProductTerminationFeeParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCalculateProductTerminationFeeTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCalculateProductTerminationFeeParams>({
    id: 'oracle_fusion_subscription_management_calculate_product_termination_fee',
    operation: 'calculate_product_termination_fee',
    name: 'Oracle Fusion Subscription Management Calculate product termination fee',
    description:
      'Calculate product termination fee using the documented Oracle calculation action.',
    outputs: {
      result: {
        type: 'json',
        description: 'Calculated fee as a number or exact decimal string',
      },
    },
  })
