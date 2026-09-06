import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetAssociatedAssetParams } from '@/tools/oracle_fusion_subscription_management/types'
import { ASSOCIATED_ASSET_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetAssociatedAssetTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetAssociatedAssetParams>({
    id: 'oracle_fusion_subscription_management_get_associated_asset',
    operation: 'get_associated_asset',
    name: 'Oracle Fusion Subscription Management Get associated asset',
    description: 'Get associated asset in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: ASSOCIATED_ASSET_OUTPUT_PROPERTIES,
      },
    },
  })
