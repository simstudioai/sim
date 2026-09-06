import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionUpdateSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'
import { SUBSCRIPTION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionUpdateSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionUpdateSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_update_subscription',
    operation: 'update_subscription',
    name: 'Oracle Fusion Subscription Management Update subscription',
    description: 'Update subscription in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: SUBSCRIPTION_OUTPUT_PROPERTIES,
      },
    },
  })
