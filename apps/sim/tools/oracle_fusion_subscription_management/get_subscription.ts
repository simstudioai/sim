import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'
import { SUBSCRIPTION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_get_subscription',
    operation: 'get_subscription',
    name: 'Oracle Fusion Subscription Management Get subscription',
    description: 'Get subscription in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: SUBSCRIPTION_OUTPUT_PROPERTIES,
      },
    },
  })
