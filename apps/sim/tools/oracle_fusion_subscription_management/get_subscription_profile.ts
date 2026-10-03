import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetSubscriptionProfileParams } from '@/tools/oracle_fusion_subscription_management/types'
import { SUBSCRIPTION_PROFILE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetSubscriptionProfileTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetSubscriptionProfileParams>({
    id: 'oracle_fusion_subscription_management_get_subscription_profile',
    operation: 'get_subscription_profile',
    name: 'Oracle Fusion Subscription Management Get subscription profile',
    description: 'Get subscription profile in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: SUBSCRIPTION_PROFILE_OUTPUT_PROPERTIES,
      },
    },
  })
