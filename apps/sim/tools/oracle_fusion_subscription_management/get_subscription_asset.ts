import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetSubscriptionAssetParams } from '@/tools/oracle_fusion_subscription_management/types'
import { SUBSCRIPTION_ASSET_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetSubscriptionAssetTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetSubscriptionAssetParams>({
    id: 'oracle_fusion_subscription_management_get_subscription_asset',
    operation: 'get_subscription_asset',
    name: 'Oracle Fusion Subscription Management Get subscription asset',
    description: 'Get subscription asset in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: SUBSCRIPTION_ASSET_OUTPUT_PROPERTIES,
      },
    },
  })
