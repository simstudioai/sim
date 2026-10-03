import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetSubscriptionItemParams } from '@/tools/oracle_fusion_subscription_management/types'
import { SUBSCRIPTION_ITEM_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetSubscriptionItemTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetSubscriptionItemParams>({
    id: 'oracle_fusion_subscription_management_get_subscription_item',
    operation: 'get_subscription_item',
    name: 'Oracle Fusion Subscription Management Get subscription item',
    description: 'Get subscription item in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: SUBSCRIPTION_ITEM_OUTPUT_PROPERTIES,
      },
    },
  })
