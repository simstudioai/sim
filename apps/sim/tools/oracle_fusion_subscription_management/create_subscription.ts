import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCreateSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'
import { SUBSCRIPTION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCreateSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCreateSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_create_subscription',
    operation: 'create_subscription',
    name: 'Oracle Fusion Subscription Management Create subscription',
    description: 'Create subscription in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: SUBSCRIPTION_OUTPUT_PROPERTIES,
      },
    },
  })
