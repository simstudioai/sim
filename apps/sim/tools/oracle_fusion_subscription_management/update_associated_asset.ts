import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionUpdateAssociatedAssetParams } from '@/tools/oracle_fusion_subscription_management/types'
import { ASSOCIATED_ASSET_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionUpdateAssociatedAssetTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionUpdateAssociatedAssetParams>({
    id: 'oracle_fusion_subscription_management_update_associated_asset',
    operation: 'update_associated_asset',
    name: 'Oracle Fusion Subscription Management Update associated asset',
    description: 'Update associated asset in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: ASSOCIATED_ASSET_OUTPUT_PROPERTIES,
      },
    },
  })
